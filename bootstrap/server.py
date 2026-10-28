import os
import sys
import uuid
import json
import shutil
import tempfile
import datetime
import subprocess
import zipfile
import asyncio
import aiohttp
import threading
import time
import torch
import pynvml
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from voxcpm import VoxCPM
import soundfile as sf

# ========== 路径与配置 ==========
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# 模型目录：engine/pretrained_models/VoxCPM2 —— 跟着软件走，卸载软件时一并删除，
# 不会在用户磁盘上留下 4.6 GB 残留。
# 环境变量 VOX_MODEL_DIR 可覆盖到外部目录（仅供排查/临时使用）。
_ENV_MODEL_DIR = os.environ.get('VOX_MODEL_DIR', '').strip()
MODEL_PATH = _ENV_MODEL_DIR or os.path.join(BASE_DIR, 'pretrained_models', 'VoxCPM2')
CUSTOM_PRESETS_FILE = os.path.join(BASE_DIR, 'custom_presets.json')
HISTORY_DIR = os.path.join(BASE_DIR, 'history')
HISTORY_FILES = {
    'design': os.path.join(HISTORY_DIR, 'history_design.json'),
    'clone': os.path.join(HISTORY_DIR, 'history_clone.json'),
    'hifi': os.path.join(HISTORY_DIR, 'history_hifi.json'),
}
os.makedirs(HISTORY_DIR, exist_ok=True)
#--------------新增声纹目录及辅助函数-----------------
VOICE_PROFILES_DIR = os.path.join(BASE_DIR, 'voice_profiles')
os.makedirs(VOICE_PROFILES_DIR, exist_ok=True)

# ---------- GPU 显存管理 ----------
pynvml.nvmlInit()
gpu_handle = pynvml.nvmlDeviceGetHandleByIndex(0)

def get_gpu_memory_info():
    try:
        info = pynvml.nvmlDeviceGetMemoryInfo(gpu_handle)
        used = info.used // 1024 // 1024
        total = info.total // 1024 // 1024
        return used, total
    except:
        return 0, 0

def cleanup_gpu_memory():
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.synchronize()

# ---------- 响度标准化（EBU R128）----------
# 为什么需要：实测同一段文本，用 -13 LUFS 的声纹生成出来是 -17 LUFS，用 -34 LUFS 的声纹
# 生成出来是 -34 LUFS —— 模型的输出音量基本跟着参考音频走。而音色库里的声纹来源五花八门，
# 实测综合响度从 -34.1 到 -13.2 LUFS（相差 20.9 dB），耳朵听就是「有的声音大、有的声音小」。
# 所以在两个位置统一到同一个标准，音量问题从源头消失：
#   1. 送进模型的参考音频 / Prompt 音频（ensure_wav）
#   2. 存进音色库的声纹文件（add_preset / update_preset）
# 标准取 -20 LUFS、真峰值 -1.5 dBTP：语音常用区间，留出混音余量，也不会削波。
LOUDNESS_TARGET_I = -20.0     # 目标综合响度（LUFS）
LOUDNESS_TARGET_TP = -1.5     # 真峰值上限（dBTP）
LOUDNESS_TARGET_LRA = 11.0    # 响度范围（LU）
LOUDNESS_MIN_I = -55.0        # 比这更轻就当静音：不放大，免得把底噪拉起来
LOUDNESS_MAX_GAIN = 20.0      # 最多提升 20 dB（同上）


def _ffmpeg_run(args, timeout=120):
    # 必须显式用 utf-8 解码：Windows 默认按 GBK 解 stderr，而 ffmpeg 在文件名含中文时
    # 会输出非 GBK 字节，text=True 会让读线程直接抛 UnicodeDecodeError（等于响度测量必失败）。
    return subprocess.run(['ffmpeg', '-hide_banner', '-nostats'] + args,
                          capture_output=True, encoding='utf-8', errors='replace',
                          timeout=timeout)


def measure_loudness(path):
    """loudnorm 第一遍：只测量、不写文件。测不出来返回 None。"""
    try:
        r = _ffmpeg_run([
            '-i', path, '-af',
            'loudnorm=I=%s:TP=%s:LRA=%s:print_format=json'
            % (LOUDNESS_TARGET_I, LOUDNESS_TARGET_TP, LOUDNESS_TARGET_LRA),
            '-f', 'null', '-'])
    except Exception as e:
        print(f'[warn] 响度测量失败：{e}', flush=True)
        return None
    err = r.stderr or ''
    a, b = err.rfind('{'), err.rfind('}')
    if a < 0 or b <= a:
        return None
    try:
        return json.loads(err[a:b + 1])
    except Exception:
        return None


def _fnum(d, key, default=None):
    try:
        return float(d.get(key))
    except (TypeError, ValueError, AttributeError):
        return default


def loudnorm_filter(path):
    """组装两遍法 loudnorm 的滤镜参数；该跳过时返回 None。

    用 linear=true 做整体增益，不压缩动态 —— 语音的抑扬顿挫要保住。
    """
    m = measure_loudness(path)
    if not m:
        return None
    i = _fnum(m, 'input_i')
    thresh = _fnum(m, 'input_thresh')
    if i is None or thresh is None or i <= LOUDNESS_MIN_I:
        return None                      # 静音 / 太轻，不动
    gain = LOUDNESS_TARGET_I - i
    if gain > LOUDNESS_MAX_GAIN:
        return None
    tp = _fnum(m, 'input_tp', 0.0)
    lra = _fnum(m, 'input_lra', LOUDNESS_TARGET_LRA)
    offset = _fnum(m, 'target_offset', 0.0)
    if abs(gain) >= 0.5:
        print('[loudness] %s：%.1f LUFS → %.0f LUFS（%+.1f dB）'
              % (os.path.basename(path), i, LOUDNESS_TARGET_I, gain), flush=True)
    return ('loudnorm=I=%s:TP=%s:LRA=%s:measured_I=%s:measured_TP=%s:'
            'measured_LRA=%s:measured_thresh=%s:offset=%s:linear=true'
            % (LOUDNESS_TARGET_I, LOUDNESS_TARGET_TP, LOUDNESS_TARGET_LRA,
               i, tp, lra, thresh, offset))


def normalize_voice_file(path):
    """把声纹文件就地统一到标准响度，保留原格式。失败返回 False，原文件保持不动。"""
    ext = os.path.splitext(path)[1].lower()
    codec = {'.wav': ['-c:a', 'pcm_s16le'],
             '.flac': ['-c:a', 'flac'],
             '.mp3': ['-c:a', 'libmp3lame', '-b:a', '192k'],
             '.m4a': ['-c:a', 'aac', '-b:a', '192k']}.get(ext)
    if not codec:
        return False
    filt = loudnorm_filter(path)
    if not filt:
        return False
    tmp = path + '.norm' + ext
    try:
        r = _ffmpeg_run(['-y', '-i', path, '-af', filt] + codec + [tmp], timeout=180)
        if r.returncode != 0 or not os.path.exists(tmp) or os.path.getsize(tmp) < 4096:
            raise RuntimeError((r.stderr or '')[-300:])
        os.replace(tmp, path)
        return True
    except Exception as e:
        print(f'[warn] 响度统一失败，保留原文件：{os.path.basename(path)}（{e}）', flush=True)
        try:
            if os.path.exists(tmp):
                os.unlink(tmp)
        except Exception:
            pass
        return False


# ---------- 模型自动下载 ----------
def ensure_wav(path, sample_rate=16000):
    """把任意格式的音频转成模型能稳定读取的 16kHz 单声道 WAV，并统一响度。

    为什么必须转：Windows 上 librosa / soundfile 对 m4a(AAC)、部分 mp3 解码不稳定，
    直接喂原始字节只会得到
        PySoundFile failed. Trying audioread instead.
    然后静音或报错。早期版本的总结文档里记录过这个坑，但转码逻辑在重构时丢了。

    为什么要统一响度：模型输出的音量跟着参考音频走（见上方 LOUDNESS_TARGET_I）。
    响度测不出来 / 该跳过时退回单纯转码，绝不阻断生成。
    """
    if not path or not os.path.exists(path):
        return path
    out = tempfile.NamedTemporaryFile(suffix='.wav', delete=False).name
    try:
        args = ['-y', '-i', path]
        filt = loudnorm_filter(path)
        if filt:
            args += ['-af', filt]
        args += ['-ar', str(sample_rate), '-ac', '1', '-sample_fmt', 's16', out]
        subprocess.run(['ffmpeg'] + args, check=True, capture_output=True, timeout=120)
        return out
    except Exception as e:
        print(f'[warn] ffmpeg 转码失败，改用原文件：{e}', flush=True)
        try:
            os.unlink(out)
        except Exception:
            pass
        return path

# 模型文件的确保与加载统一交给后台线程 _bootstrap()（见下方）。
# 不能再在这里同步调用 —— 那样首次启动要等 4.7GB 下完端口才打开，
# 客户端只会看到「等待后端超时」。

# ---------- 预设管理 ----------
def load_custom_presets():
    if os.path.exists(CUSTOM_PRESETS_FILE):
        with open(CUSTOM_PRESETS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_custom_presets(presets):
    with open(CUSTOM_PRESETS_FILE, 'w', encoding='utf-8') as f:
        json.dump(presets, f, ensure_ascii=False, indent=2)

# 内置100组预设（请确保完整粘贴你的100组）
STYLE_PRESETS = {
    "无": "",
    "严厉女教师": "(女，中年，声线偏窄，语速快，句尾降调，不怒自威)",
    # ... 你的完整100组预设 ...
    "旁白·史诗式": "(男，成年，浑厚回响，语速慢，句尾气势磅礴)",
}

def get_all_presets():
    base = dict(STYLE_PRESETS)
    custom = load_custom_presets()
    for name, desc in custom.items():
        base[f"★ {name}"] = desc
    return base

def combine_text(user_text, style_preset):
    """把「音色/风格描述」按 VoxCPM2 的官方格式拼进待合成文本。

    官方 CLI（voxcpm/cli.py 的 build_final_text）要求的格式是：
        (控制描述)正文
    描述必须用**圆括号**包起来、紧贴正文，模型才会把它当控制指令。
    写成「描述 正文」（无括号、带空格）模型不认，等于没传 ——
    音色会退化成随机的默认音色。这是之前音色设计"描述不生效"的根因。

    style_preset 有两种来源，都要支持：
      - 配音页传的是预设名（如「温柔」「★ 我的音色」）→ 查预设表换成描述
      - 音色设计页传的是用户直接输入的描述 → 查不到就当作描述原文
    """
    style = (style_preset or "").strip()
    if not style or style == "无":
        return user_text
    desc = (get_all_presets().get(style) or "").strip()
    if not desc:
        desc = style                      # 不在预设表里 → 视为用户直接输入的描述
    desc = desc.strip().strip("()（）").strip()   # 避免外面再套一层变成 ((…))
    if not desc:
        return user_text
    return f"({desc}){user_text}"


def apply_seed(seed):
    """给生成过程固定随机种子；seed < 0 表示不固定。

    为什么需要：模型内部用 torch.randn 采样（流匹配），同一句描述
    每次生成的音色会飘。实测同一描述两次的声学特征差异 0.17~0.26，
    甚至比"不同描述之间的差异"（0.17~0.25）还大 —— 描述的作用被随机性淹没，
    用户体验就是"填描述没用、每次都不一样"。
    实测固定种子后同描述两次差异为 0（完全可复现），换种子才得到不同结果。
    所以产品侧用「描述文本派生的种子」，做到同描述同音色、并可「换一版」。
    """
    try:
        s = int(seed)
    except Exception:
        return
    if s < 0:
        return
    try:
        import torch
        torch.manual_seed(s)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(s)
    except Exception:
        pass
    try:
        import numpy as _np
        _np.random.seed(s % (2 ** 32 - 1))
    except Exception:
        pass

# ---------- 历史记录 ----------
def load_history(mode):
    path = HISTORY_FILES.get(mode)
    if path and os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []

def save_history(mode, history):
    path = HISTORY_FILES.get(mode)
    if path:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(history[:10], f, ensure_ascii=False, indent=2)

def save_audio_and_record(mode: str, text: str, wav):
    filename = f"{uuid.uuid4().hex}.wav"
    filepath = os.path.join(HISTORY_DIR, filename)
    sf.write(filepath, wav, model.tts_model.sample_rate)
    history = load_history(mode)
    history.insert(0, {"text": text, "audio": filename, "time": datetime.datetime.now().strftime("%H:%M:%S")})
    if len(history) > 10:
        history = history[:10]
    save_history(mode, history)
    return filename

# ---------- 模型加载（后台线程，不阻塞服务启动）----------
# 原先这里是阻塞式加载，模型读完才轮到 FastAPI 创建 ——
# 端口要等 30 秒才开始监听，客户端只能干等。
# 改成：服务立即启动，模型在后台线程加载，用 /api/ready 查询进度。
_model = None
model_error = None
_model_ready = threading.Event()
_model_started_at = time.time()
# 供 /api/ready 查询的阶段状态：downloading / loading / ready / error
_phase = {'phase': 'starting', 'message': '准备中', 'progress': 0.0, 'downloaded': 0}


class _ModelProxy:
    """模型加载完成前，任何对 model 的访问都返回 503 而不是 NoneType 报错。
    这样无需逐个路由加判断，语义也更准确（服务在，引擎还没好）。"""

    def __getattr__(self, name):
        if _model is None:
            raise HTTPException(
                status_code=503,
                detail=model_error or "模型仍在加载中，请稍候再试")
        return getattr(_model, name)


model = _ModelProxy()


def _engine_info():
    """引擎版本信息，供客户端自检展示"""
    info = {"voxcpm": "?", "torch": "?", "device": "?"}
    try:
        import importlib.metadata as md
        info["voxcpm"] = md.version("voxcpm")
    except Exception:
        pass
    try:
        info["torch"] = torch.__version__
        info["cuda"] = torch.version.cuda or ""
        info["gpu"] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
        # 实际推理设备。以前这里从来没赋值，永远是初始的 "?"，
        # 界面就显示不出"到底用显卡还是 CPU"。
        info["device"] = "cuda" if torch.cuda.is_available() else "cpu"
        if torch.cuda.is_available():
            try:
                info["vram_gb"] = round(torch.cuda.get_device_properties(0).total_memory / 1024 ** 3, 1)
            except Exception:
                pass
    except Exception:
        pass
    return info


MODEL_WEIGHT = os.path.join(MODEL_PATH, 'model.safetensors')
MODEL_SIZE_HINT = int(4.7 * 1024 ** 3)     # 用于估算下载进度（实际约 4.57 GB）


def _dir_size(p):
    total = 0
    for root, _dirs, files in os.walk(p):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


MODEL_REPO = "OpenBMB/VoxCPM2"
# 注意：这里的字节数是实测值，只用于估算下载进度。
# 曾写成 376,982,016（比实际大 30 KB），导致判定永远"差一点"→反复续传→服务器回 416。
# 上游换过文件时，用 fetchmodel.py 重新核对这几个数。
MODEL_FILES = [
    ("model.safetensors", 4580080592),
    ("audiovae.pth", 376951122),
    ("tokenizer.json", 3676772),
    ("config.json", 4336),
    ("tokenizer_config.json", 5059),
    ("special_tokens_map.json", 1632),
    ("tokenization_voxcpm2.py", 2895),
]
MIRRORS = [
    "https://modelscope.cn/models/{repo}/resolve/master/{file}",
    "https://hf-mirror.com/{repo_lower}/resolve/main/{file}",
]

_cur_file = {"name": "", "done": 0, "total": 0, "mbps": 0.0}


def _fetch(url, dest, stop):
    """流式下载单个文件，边下边更新 _cur_file。返回 True/False。"""
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "VoxWorkstation/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            total = int(r.headers.get("Content-Length") or 0)
            _cur_file.update(name=os.path.basename(dest), done=0, total=total)
            t0 = time.time()
            with open(dest, "wb") as f:
                while True:
                    chunk = r.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    _cur_file["done"] += len(chunk)
                    el = time.time() - t0
                    if el > 0:
                        _cur_file["mbps"] = (_cur_file["done"] / 1048576) / el
                    # 同步到 /api/ready 的进度
                    _phase["downloaded"] = _dir_size(MODEL_PATH)
                    _phase["progress"] = min(0.99, _phase["downloaded"] / MODEL_SIZE_HINT)
                    _phase["mbps"] = round(_cur_file["mbps"], 2)
                    if stop.is_set():
                        return False
        return os.path.getsize(dest) > 0
    except Exception as e:
        print(f"  [下载失败] {url} -> {e}", flush=True)
        try:
            if os.path.exists(dest):
                os.unlink(dest)
        except OSError:
            pass
        return False


def _download_model_files():
    """直接从 ModelScope 直链下载。

    不用 modelscope 的 snapshot_download：它走另一套 API 端点、逐文件校验，
    实测比直链慢很多（直链可持续 17+ MB/s，4.4 GB 约 4 分钟）。
    直链失败时回退 snapshot_download。
    """
    stop = threading.Event()
    ok = True
    for name, _size in MODEL_FILES:
        dest = os.path.join(MODEL_PATH, name)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            continue
        print(f"  下载 {name} ...", flush=True)
        got = False
        for tpl in MIRRORS:
            url = tpl.format(repo=MODEL_REPO, repo_lower=MODEL_REPO.lower(), file=name)
            if _fetch(url, dest, stop):
                got = True
                print(f"    {name} 完成（{os.path.getsize(dest)/1048576:.1f} MB）", flush=True)
                break
        if not got:
            ok = False
            break
    if not ok or not os.path.exists(MODEL_WEIGHT):
        print("  直链下载未成功，回退 modelscope.snapshot_download ...", flush=True)
        from modelscope import snapshot_download
        snapshot_download(MODEL_REPO, local_dir=MODEL_PATH)


def _gpu_precheck():
    """判断该用什么设备跑，返回 (设备, 说明)。

    策略：能上 GPU 就上 GPU；不满足就退 CPU，而不是直接拒绝 ——
    慢总比不能用强。实测 GTX 1050 Ti（Pascal 6.1 / 4GB）：
    bf16 在 Pascal 上不支持，且 4GB 显存放不下 4.4GB 的模型，
    但它有 16GB 内存，用 float32 在 CPU 上能跑（慢）。
    """
    try:
        import torch
    except Exception as e:
        return None, "PyTorch 未正确安装：" + str(e)
    try:
        if not torch.cuda.is_available():
            return "cpu", ("未检测到可用的 CUDA 设备，将使用 CPU 运行（较慢）。"
                           "若你有 NVIDIA 显卡，多半是装了 CPU 版 PyTorch —— "
                           "需从 CUDA 源重装：pip install torch torchaudio "
                           "--index-url https://download.pytorch.org/whl/cu121")
        cap = torch.cuda.get_device_capability(0)
        name = torch.cuda.get_device_name(0)
        vram = torch.cuda.get_device_properties(0).total_memory / 1024 ** 3
        if cap[0] < 8:
            return "cpu", (f"{name} 为 {cap[0]}.{cap[1]} 架构，不支持 bfloat16"
                           "（本模型以 bf16 加载，需 8.0 及以上）。"
                           "已自动改用 CPU 运行 —— 可以出声，但速度会慢很多。")
        # 实测（RTX 4060 Ti）：模型本体约 5.5 GB，生成峰值约 5.8 GB，
        # 故 6 GB 为可用下限；8 GB 及以上更宽裕
        if vram < 6:
            return "cpu", (f"{name} 显存仅 {vram:.1f} GB，低于实测下限 6 GB。"
                           "已自动改用 CPU 运行 —— 可以出声，但速度会慢很多。")
        return "cuda", f"{name}（{cap[0]}.{cap[1]}，{vram:.1f} GB）"
    except Exception as e:
        return "cpu", "显卡检测失败，改用 CPU 运行：" + str(e)


def _bootstrap():
    """后台线程：确保模型文件（必要时下载）→ 加载模型。

    下载放在这里而不是模块顶层，是因为 uvicorn 必须立刻开始监听 ——
    否则首次启动要等 4.7GB 下完端口才打开，客户端只会看到超时。
    """
    global _model, model_error
    try:
        # 1) 模型文件
        if not os.path.exists(MODEL_WEIGHT):
            _phase.update(phase='downloading', message='正在下载模型', progress=0.0)
            print("未检测到模型权重，开始从 ModelScope 下载（约 4.7 GB）...", flush=True)
            stop = threading.Event()

            def _report():
                while not stop.wait(3):
                    sz = _dir_size(MODEL_PATH)
                    _phase['downloaded'] = sz
                    _phase['progress'] = min(0.99, sz / MODEL_SIZE_HINT)

            threading.Thread(target=_report, daemon=True, name="dl-progress").start()
            try:
                os.makedirs(MODEL_PATH, exist_ok=True)
                _download_model_files()
            finally:
                stop.set()
            if not os.path.exists(MODEL_WEIGHT):
                raise RuntimeError("模型下载后仍未找到 model.safetensors，请检查网络或磁盘空间")
            _phase.update(progress=1.0, downloaded=_dir_size(MODEL_PATH))
            print("模型下载完成。", flush=True)

        # 2) 选择设备：GPU 可用就用 GPU，否则退 CPU（慢，但能出声）
        _dev, _dev_msg = _gpu_precheck()
        print("设备检查：" + _dev_msg, flush=True)
        _phase['device_note'] = _dev_msg

        _phase.update(phase='loading', message='正在加载模型')
        print("正在加载 VoxCPM2 模型...", flush=True)
        _t0 = time.time()

        # CPU 上必须用 float32：bf16 在 CPU 上很多算子没实现，
        # 实测会直接崩（Windows 报 0xC0000005 访问违例）
        _kw = dict(load_denoiser=False, optimize=True)
        if _dev == 'cpu':
            try:
                import torch as _t
                _kw['torch_dtype'] = _t.float32
            except Exception:
                pass
        else:
            _kw['device'] = _dev

        try:
            _model = VoxCPM.from_pretrained(MODEL_PATH, **_kw)
        except TypeError as _e:
            # 该版本不接受 device / torch_dtype 时退回最简调用
            print(f"（{_e}，改用默认参数加载）", flush=True)
            _model = VoxCPM.from_pretrained(MODEL_PATH, load_denoiser=False, optimize=True)
        _phase.update(phase='ready', message='就绪', progress=1.0)
        print(f"模型加载完毕，用时 {time.time() - _t0:.1f}s。", flush=True)
    except Exception as e:
        model_error = str(e)
        _phase.update(phase='error', message='失败', error=str(e))
        print(f"模型加载失败：{e}", flush=True)
    finally:
        _model_ready.set()


threading.Thread(target=_bootstrap, daemon=True, name="voxcpm-loader").start()

# ---------- FastAPI 应用 ----------
app = FastAPI()


@app.post("/api/selftest")
async def api_selftest():
    """生成一句测试语音，用于快速验证「能不能出声」。

    不需要建项目、不需要选音色 —— 设计成一个按钮就能确认链路是否通。
    """
    text = "你好，这是一句语音测试。如果你能听到这句话，说明引擎工作正常。"
    t0 = time.time()
    try:
        wav = model.generate(text=text, cfg_value=2.0, inference_timesteps=10)
        import soundfile as _sf
        name = f"selftest_{int(time.time())}.wav"
        out = os.path.join(HISTORY_DIR, name)
        _sf.write(out, wav, model.tts_model.sample_rate)
        return {
            "ok": True,
            "file": name,
            "url": f"/api/audio/{name}",
            "elapsed_ms": int((time.time() - t0) * 1000),
            "sample_rate": model.tts_model.sample_rate,
            "device_note": _phase.get("device_note", ""),
        }
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e),
                             "elapsed_ms": int((time.time() - t0) * 1000)}, status_code=500)


@app.get("/api/ready")
async def api_ready():
    """引擎状态。phase: downloading | loading | ready | error"""
    return {
        "ready": _model is not None,
        "loading": not _model_ready.is_set(),
        "phase": _phase.get("phase", "loading"),
        "message": _phase.get("message", ""),
        "progress": round(float(_phase.get("progress", 0.0)), 3),
        "downloaded_mb": int(_phase.get("downloaded", 0) / 1024 / 1024),
        "mbps": _phase.get("mbps", 0),
        "expected_mb": int(MODEL_SIZE_HINT / 1024 / 1024),
        "error": model_error,
        "elapsed_ms": int((time.time() - _model_started_at) * 1000),
        "engine": _engine_info(),
        "device_note": _phase.get("device_note", ""),
    }


# 说明：原先这里挂载 static/ 提供后端自带的 Web UI（dashboard.html）。
# 本软件用 Electron 前端，不需要它；static/ 已移出到 _engine-legacy/。
# 保留一个根路由，方便用浏览器确认后端是否活着。


@app.get("/")
async def index():
    return {"service": "VoxCPM2 backend", "ready": _model is not None,
            "docs": "/docs"}


# ========== 预设 API（升级版，支持声纹保存和编辑） ==========
@app.post("/api/presets")
async def get_presets():
    """返回所有预设，包含名称、描述、是否有声纹"""
    presets_data = []
    custom = load_custom_presets()
    for name, desc in custom.items():
        voice_file = None
        # 检查是否存在同名声纹文件（支持 wav/mp3）
        for ext in ['.wav', '.mp3']:
            maybe_path = os.path.join(VOICE_PROFILES_DIR, name + ext)
            if os.path.exists(maybe_path):
                voice_file = name + ext
                break
        presets_data.append({
            "name": name,
            "desc": desc,
            "voice_file": voice_file
        })
    return {"presets": presets_data}

@app.post("/api/add_preset")
async def add_preset(
    name: str = Form(...),
    desc: str = Form(""),
    voice: UploadFile = File(None)
):
    """添加预设，可选上传声纹音频"""
    if not name.strip():
        return JSONResponse({"error": "名称不能为空"}, status_code=400)

    presets = load_custom_presets()
    if name in presets:
        return JSONResponse({"error": "预设名称已存在"}, status_code=400)

    # 保存描述
    presets[name] = desc
    save_custom_presets(presets)

    # 处理声纹文件
    if voice and voice.filename:
        ext = os.path.splitext(voice.filename)[1] or ".wav"
        allowed_ext = ['.wav', '.mp3', '.m4a', '.flac']
        if ext.lower() not in allowed_ext:
            return JSONResponse({"error": f"不支持的音频格式: {ext}"}, status_code=400)
        voice_path = os.path.join(VOICE_PROFILES_DIR, name + ext)
        with open(voice_path, "wb") as f:
            f.write(await voice.read())
        # 统一响度：音色库里的声音大小要一致（失败只保留原文件，不让保存失败）
        normalize_voice_file(voice_path)
    return {"status": "ok"}

@app.post("/api/update_preset")
async def update_preset(
    old_name: str = Form(...),
    new_name: str = Form(...),
    desc: str = Form(""),
    voice: UploadFile = File(None)
):
    """修改预设：名称、描述、声纹（三者都可以单独改）。

    注意「没上传新声纹」这种最普通的改名场景：旧实现在任何情况下都先删旧文件，
    只有上传了新文件才写回 —— 于是只改名会把声纹直接删掉。
    这里改为没有新文件时，把旧声纹读进内存再按新名字写回。
    """
    presets = load_custom_presets()
    if old_name not in presets:
        return JSONResponse({"error": "预设不存在"}, status_code=404)

    new_name = new_name.strip()
    if not new_name:
        return JSONResponse({"error": "名称不能为空"}, status_code=400)
    if new_name != old_name and new_name in presets:
        return JSONResponse({"error": "已存在同名音色"}, status_code=400)

    # 先取旧声纹内容（用于改名时沿用），再决定怎么写
    reuse_bytes, reuse_ext = None, ''
    for ext in ['.wav', '.mp3', '.m4a', '.flac']:
        old_voice_path = os.path.join(VOICE_PROFILES_DIR, old_name + ext)
        if os.path.exists(old_voice_path):
            if reuse_bytes is None:
                with open(old_voice_path, 'rb') as f:
                    reuse_bytes = f.read()
                reuse_ext = ext
            os.unlink(old_voice_path)

    if new_name != old_name:
        del presets[old_name]
    presets[new_name] = desc
    save_custom_presets(presets)

    if voice and voice.filename:
        ext = os.path.splitext(voice.filename)[1] or ".wav"
        allowed_ext = ['.wav', '.mp3', '.m4a', '.flac']
        if ext.lower() not in allowed_ext:
            return JSONResponse({"error": f"不支持的音频格式: {ext}"}, status_code=400)
        voice_path = os.path.join(VOICE_PROFILES_DIR, new_name + ext)
        with open(voice_path, "wb") as f:
            f.write(await voice.read())
        # 换了新声纹 → 同样统一响度（只改名/改描述时不重编码旧文件）
        normalize_voice_file(voice_path)
    elif reuse_bytes is not None:
        # 没传新声纹：沿用旧内容，只换名字
        with open(os.path.join(VOICE_PROFILES_DIR, new_name + reuse_ext), "wb") as f:
            f.write(reuse_bytes)
    return {"status": "ok"}

@app.post("/api/delete_preset")
async def delete_preset(name: str = Form(...)):
    name = name.replace("★ ", "")
    presets = load_custom_presets()
    if name in presets:
        del presets[name]
        save_custom_presets(presets)
        # 删除声纹
        for ext in ['.wav', '.mp3', '.m4a', '.flac']:
            voice_path = os.path.join(VOICE_PROFILES_DIR, name + ext)
            if os.path.exists(voice_path):
                os.unlink(voice_path)
        return {"status": "ok"}
    return JSONResponse({"status": "not found"}, status_code=404)

@app.get("/api/preset/voice/{name}")
async def get_preset_voice(name: str):
    """下载预设对应的声纹文件"""
    for ext in ['.wav', '.mp3', '.m4a', '.flac']:
        path = os.path.join(VOICE_PROFILES_DIR, name + ext)
        if os.path.exists(path):
            _mt = {'.wav': 'audio/wav', '.mp3': 'audio/mpeg',
                   '.m4a': 'audio/mp4', '.flac': 'audio/flac'}.get(ext, 'audio/wav')
            return FileResponse(path, media_type=_mt)
    raise HTTPException(status_code=404, detail="voice not found")

# ========== 生成 API（已移除 speed/pitch，保证稳定） ==========
@app.post("/api/generate/design")
async def generate_design(
    text: str = Form(...),
    style: str = Form("无"),
    cfg: float = Form(2.0),
    steps: int = Form(10),
    seed: int = Form(-1)
):
    full_text = combine_text(text, style)
    try:
        apply_seed(seed)
        wav = model.generate(
            text=full_text,
            cfg_value=cfg,
            inference_timesteps=steps,
        )
        filename = save_audio_and_record('design', full_text, wav)
        cleanup_gpu_memory()
        return FileResponse(os.path.join(HISTORY_DIR, filename), media_type="audio/wav", filename=filename)
    except Exception as e:
        cleanup_gpu_memory()
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/api/generate/clone")
async def generate_clone(
    text: str = Form(...),
    style: str = Form("无"),
    ref_audio: UploadFile = File(None),
    voice_profile: str = Form(""),
    cfg: float = Form(2.0),
    steps: int = Form(10)
):
    full_text = combine_text(text, style)
    ref_path = None
    try:
        # 如果指定了预设声纹且未上传音频，则使用预设声纹
        if voice_profile and not ref_audio:
            # 寻找声纹文件
            found = False
            for ext in ['.wav', '.mp3', '.m4a', '.flac']:
                vp = os.path.join(VOICE_PROFILES_DIR, voice_profile + ext)
                if os.path.exists(vp):
                    ref_path = ensure_wav(vp)   # 声纹可能是 m4a/flac，同样要转
                    found = True
                    break
            if not found:
                return JSONResponse({"error": "该预设没有声纹文件，请上传参考音频"}, status_code=400)
        else:
            # 上传了音频，保存临时文件
            if ref_audio:
                _raw = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
                with open(_raw, "wb") as f:
                    f.write(await ref_audio.read())
                ref_path = ensure_wav(_raw)      # m4a/mp3 必须转码，否则解码失败
            else:
                return JSONResponse({"error": "请上传参考音频或选择带有声纹的预设"}, status_code=400)

        wav = model.generate(
            text=full_text,
            reference_wav_path=ref_path,
            cfg_value=cfg,
            inference_timesteps=steps,
        )
        filename = save_audio_and_record('clone', full_text, wav)
        # 清理临时文件（仅当上传了音频才删除临时文件）
        if ref_audio and ref_path and os.path.exists(ref_path):
            os.unlink(ref_path)
        cleanup_gpu_memory()
        return FileResponse(os.path.join(HISTORY_DIR, filename), media_type="audio/wav", filename=filename)
    except Exception as e:
        if ref_audio and ref_path and os.path.exists(ref_path):
            os.unlink(ref_path)
        cleanup_gpu_memory()
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/api/generate/hifi")
async def generate_hifi(
    text: str = Form(...),
    prompt_audio: UploadFile = File(...),
    prompt_text: str = Form(...),
    ref_audio: UploadFile = File(None),
    cfg: float = Form(2.0),
    steps: int = Form(10)
):
    _praw = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    _praw.write(await prompt_audio.read())
    _praw.close()
    # ensure_wav 返回的是**路径字符串**。早期代码在这里取了文件对象才有的 .name 属性，
    # 必然 AttributeError → 极致克隆每次都 500。这里统一用路径本身。
    prompt_path = ensure_wav(_praw.name)      # 同上：转码 + 统一响度
    ref_path = None
    if ref_audio:
        ref_f = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        ref_f.write(await ref_audio.read())
        ref_f.close()
        ref_path = ensure_wav(ref_f.name)
    try:
        wav = model.generate(
            text=text,
            prompt_wav_path=prompt_path,
            prompt_text=prompt_text,
            reference_wav_path=ref_path,
            cfg_value=cfg,
            inference_timesteps=steps,
        )
        filename = save_audio_and_record('hifi', text, wav)
        cleanup_gpu_memory()
        return FileResponse(os.path.join(HISTORY_DIR, filename), media_type="audio/wav", filename=filename)
    except Exception as e:
        cleanup_gpu_memory()
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        for _p in (prompt_path, ref_path, _praw.name):
            try:
                if _p and os.path.exists(_p):
                    os.unlink(_p)
            except Exception:
                pass

# ========== 历史与音频服务 ==========
@app.get("/api/history/{mode}")
async def get_history(mode: str):
    if mode not in HISTORY_FILES:
        raise HTTPException(status_code=400, detail="invalid mode")
    history = load_history(mode)
    for item in history:
        filename = item['audio']
        filepath = os.path.join(HISTORY_DIR, filename)
        # 临时诊断日志
        print(f"检查文件: {filepath}, 存在: {os.path.exists(filepath)}")
        item['audio_url'] = f"/api/audio/{item['audio']}"
        item['file_exists'] = os.path.exists(filepath)
    return JSONResponse(history)

@app.get("/api/audio/{filename}")
async def get_audio(filename: str):
    filepath = os.path.join(HISTORY_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="audio not found")
    return FileResponse(filepath, media_type="audio/wav")

@app.get("/api/download/{filename}")
async def download_audio(filename: str):
    filepath = os.path.join(HISTORY_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="audio not found")
    return FileResponse(
        filepath,
        media_type="audio/wav",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# ========== 工具 API ==========
AUDIO_FORMATS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']
VIDEO_FORMATS = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv']


def _remove_file(path):
    """响应发完后再删临时文件（FileResponse 的 background 钩子）。"""
    try:
        if path and os.path.exists(path):
            os.unlink(path)
    except Exception:
        pass

@app.post("/api/tools/audio/convert")
async def convert_audio(
    file: UploadFile = File(...),
    target_format: str = Form(...),
    sample_rate: int = Form(44100),
    bitrate: str = Form("192k")
):
    if target_format not in AUDIO_FORMATS:
        return JSONResponse({"error": f"不支持的音频格式: {target_format}"}, status_code=400)
    input_ext = os.path.splitext(file.filename)[1] or ".tmp"
    with tempfile.NamedTemporaryFile(suffix=input_ext, delete=False) as tmp_in:
        tmp_in.write(await file.read())
        input_path = tmp_in.name
    output_path = tempfile.mktemp(suffix=f".{target_format}")
    try:
        cmd = ["ffmpeg", "-y", "-i", input_path, "-ar", str(sample_rate), "-vn"]
        # WAV / FLAC 是无损格式，码率参数没有意义（传了 ffmpeg 会告警），只对有损格式加
        if target_format in ('mp3', 'm4a', 'aac', 'ogg'):
            cmd += ["-ab", bitrate]
        cmd += [output_path]
        subprocess.run(cmd, check=True, capture_output=True, timeout=600)
    except subprocess.CalledProcessError as e:
        os.unlink(input_path)
        err = (e.stderr or b'').decode('utf-8', 'replace')
        return JSONResponse({"error": f"转换失败: {err[-400:]}"}, status_code=500)
    os.unlink(input_path)
    # 临时文件在响应发完后删掉：以前这里没人清理，转换过的文件会一直堆在系统临时目录
    return FileResponse(output_path, media_type=f"audio/{target_format}",
                        filename=f"converted.{target_format}",
                        background=BackgroundTask(_remove_file, output_path))

@app.post("/api/tools/video/convert")
async def convert_video(
    file: UploadFile = File(...),
    target_format: str = Form(...),
    video_bitrate: str = Form("1M")
):
    if target_format not in VIDEO_FORMATS:
        return JSONResponse({"error": f"不支持的视频格式: {target_format}"}, status_code=400)
    input_ext = os.path.splitext(file.filename)[1] or ".tmp"
    with tempfile.NamedTemporaryFile(suffix=input_ext, delete=False) as tmp_in:
        tmp_in.write(await file.read())
        input_path = tmp_in.name
    output_path = tempfile.mktemp(suffix=f".{target_format}")
    try:
        cmd = ["ffmpeg", "-y", "-i", input_path, "-b:v", video_bitrate, output_path]
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        os.unlink(input_path)
        return JSONResponse({"error": f"转换失败: {e.stderr.decode()}"}, status_code=500)
    os.unlink(input_path)
    return FileResponse(output_path, media_type=f"video/{target_format}", filename=f"converted.{target_format}")

# ========== 新增音频工具 API ==========
@app.post("/api/tools/audio/trim")
async def audio_trim(
    file: UploadFile = File(...),
    start: float = Form(0),
    end: float = Form(0)
):
    input_ext = os.path.splitext(file.filename)[1] or ".tmp"
    with tempfile.NamedTemporaryFile(suffix=input_ext, delete=False) as tmp_in:
        tmp_in.write(await file.read())
        input_path = tmp_in.name
    output_path = tempfile.mktemp(suffix=".wav")
    try:
        cmd = ["ffmpeg", "-y", "-i", input_path, "-ss", str(start)]
        if end > 0:
            cmd += ["-to", str(end)]
        cmd += ["-acodec", "pcm_s16le", output_path]   # 强制重编码，保证精确裁剪
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        os.unlink(input_path)
        return JSONResponse({"error": f"裁剪失败: {e.stderr.decode()}"}, status_code=500)
    os.unlink(input_path)
    return FileResponse(output_path, media_type="audio/wav", filename="trimmed.wav")

@app.post("/api/tools/audio/merge")
async def audio_merge(files: list[UploadFile] = File(...)):
    """合并多个音频文件（按上传顺序拼接）"""
    if len(files) < 2:
        return JSONResponse({"error": "至少需要两个音频文件"}, status_code=400)
    # 保存所有临时文件
    temp_files = []
    filelist_path = tempfile.mktemp(suffix=".txt")
    try:
        for file in files:
            ext = os.path.splitext(file.filename)[1] or ".tmp"
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp_in:
                tmp_in.write(await file.read())
                temp_files.append(tmp_in.name)
        # 创建合并列表
        with open(filelist_path, "w", encoding="utf-8") as f:
            for fp in temp_files:
                f.write(f"file '{fp}'\n")
        output_path = tempfile.mktemp(suffix=".wav")
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", filelist_path, "-c", "copy", output_path],
            check=True, capture_output=True
        )
    except subprocess.CalledProcessError as e:
        for fp in temp_files:
            if os.path.exists(fp): os.unlink(fp)
        if os.path.exists(filelist_path): os.unlink(filelist_path)
        return JSONResponse({"error": f"合并失败: {e.stderr.decode()}"}, status_code=500)
    finally:
        for fp in temp_files:
            if os.path.exists(fp): os.unlink(fp)
        if os.path.exists(filelist_path): os.unlink(filelist_path)
    return FileResponse(output_path, media_type="audio/wav", filename="merged.wav")

@app.post("/api/tools/audio/extract")
async def audio_extract(file: UploadFile = File(...), target_format: str = Form("mp3")):
    """从视频中提取音频，格式可选 mp3/wav"""
    if target_format not in ['mp3', 'wav']:
        return JSONResponse({"error": "仅支持 mp3 或 wav 格式"}, status_code=400)
    input_ext = os.path.splitext(file.filename)[1] or ".tmp"
    with tempfile.NamedTemporaryFile(suffix=input_ext, delete=False) as tmp_in:
        tmp_in.write(await file.read())
        input_path = tmp_in.name
    output_path = tempfile.mktemp(suffix=f".{target_format}")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", input_path, "-vn", "-acodec", "libmp3lame" if target_format == "mp3" else "pcm_s16le", output_path],
            check=True, capture_output=True
        )
    except subprocess.CalledProcessError as e:
        os.unlink(input_path)
        return JSONResponse({"error": f"提取失败: {e.stderr.decode()}"}, status_code=500)
    os.unlink(input_path)
    return FileResponse(output_path, media_type=f"audio/{target_format}", filename=f"extracted.{target_format}")

@app.post("/api/tools/audio/volume")
async def audio_volume(
    file: UploadFile = File(...),
    db: float = Form(0)
):
    """调节音量，db 可为负数（降低）或正数（提高），如 3 或 -2.5"""
    input_ext = os.path.splitext(file.filename)[1] or ".tmp"
    with tempfile.NamedTemporaryFile(suffix=input_ext, delete=False) as tmp_in:
        tmp_in.write(await file.read())
        input_path = tmp_in.name
    output_path = tempfile.mktemp(suffix=".wav")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", input_path, "-af", f"volume={db}dB", output_path],
            check=True, capture_output=True
        )
    except subprocess.CalledProcessError as e:
        os.unlink(input_path)
        return JSONResponse({"error": f"音量调节失败: {e.stderr.decode()}"}, status_code=500)
    os.unlink(input_path)
    return FileResponse(output_path, media_type="audio/wav", filename=f"volume_{db}dB.wav")


# ========== 批量生成 ==========
@app.post("/api/generate/batch")
async def batch_generate(
    lines: str = Form(""),
    txt_file: UploadFile = File(None),
    style: str = Form("无"),
    cfg: float = Form(2.0),
    steps: int = Form(10),
    voice_profile: str = Form(""),          # 预设声纹名称
    ref_audio: UploadFile = File(None)      # 手动上传参考音频
):
    texts = []
    if txt_file:
        content = (await txt_file.read()).decode("utf-8")
        texts = [line.strip() for line in content.split('\n') if line.strip()]
    if lines:
        texts.extend([line.strip() for line in lines.split('\n') if line.strip()])

    if not texts:
        return JSONResponse({"error": "没有可合成的文本"}, status_code=400)

    # 确定参考音频路径
    ref_path = None
    if voice_profile:
        # 查找声纹文件
        for ext in ['.wav', '.mp3', '.m4a', '.flac']:
            vp = os.path.join(VOICE_PROFILES_DIR, voice_profile + ext)
            if os.path.exists(vp):
                ref_path = ensure_wav(vp)       # 同上
                break
        if not ref_path:
            return JSONResponse({"error": f"预设“{voice_profile}”没有声纹文件，请上传参考音频"}, status_code=400)
    elif ref_audio:
        _braw = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
        with open(_braw, "wb") as f:
            f.write(await ref_audio.read())
        ref_path = ensure_wav(_braw)          # 同上，格式统一
    else:
        # 如果没有声纹也没有上传音频，则回退到普通音色设计（但会随机）
        # 如果你希望强制克隆，可返回错误；这里选择兼容原行为
        pass

    zip_filename = f"batch_{uuid.uuid4().hex}.zip"
    zip_path = os.path.join(HISTORY_DIR, zip_filename)
    with zipfile.ZipFile(zip_path, 'w') as zf:
        for i, t in enumerate(texts):
            full_text = combine_text(t, style)
            try:
                if ref_path:
                    wav = model.generate(
                        text=full_text,
                        reference_wav_path=ref_path,
                        cfg_value=cfg,
                        inference_timesteps=steps,
                    )
                else:
                    wav = model.generate(
                        text=full_text,
                        cfg_value=cfg,
                        inference_timesteps=steps,
                    )
                audio_name = f"{i+1:03d}.wav"
                audio_path = os.path.join(HISTORY_DIR, audio_name)
                sf.write(audio_path, wav, model.tts_model.sample_rate)
                zf.write(audio_path, audio_name)
                os.unlink(audio_path)
            except Exception as e:
                zf.writestr(f"{i+1:03d}_error.txt", f"错误: {e}")

    cleanup_gpu_memory()
    # 清理临时上传的音频
    if ref_path and not voice_profile and os.path.exists(ref_path):
        os.unlink(ref_path)
    return FileResponse(zip_path, media_type="application/zip", filename=zip_filename)
# ========== 显存状态 ==========
@app.get("/api/gpu/memory")
async def gpu_memory():
    used, total = get_gpu_memory_info()
    return {"used_mb": used, "total_mb": total, "percent": round(used/total*100, 1) if total else 0}

# ========== 链接检测 ==========
@app.post("/api/check-links")
async def check_links(data: dict):
    links = data.get("links", [])
    if not links:
        return JSONResponse({"error": "no links provided"}, status_code=400)

    async def check_single(session, url):
        try:
            async with session.head(url, timeout=aiohttp.ClientTimeout(total=5), allow_redirects=True) as resp:
                return url, resp.status < 500
        except Exception:
            return url, False

    results = {}
    async with aiohttp.ClientSession() as session:
        tasks = [check_single(session, url) for url in links]
        responses = await asyncio.gather(*tasks)
        for url, ok in responses:
            results[url] = {"reachable": ok}
    return results


# ========== 启动服务 ==========
# ========== 启动服务 ==========
def _resolve_port():
    """端口可由 VOX_PORT 环境变量或 --port 参数指定。

    写死 8000 会导致：该端口被别的程序占用时 uvicorn 绑不上直接退出，
    客户端只看到一个没头没尾的 code=3，很难定位。
    """
    for i, a in enumerate(sys.argv):
        if a == "--port" and i + 1 < len(sys.argv):
            return int(sys.argv[i + 1])
        if a.startswith("--port="):
            return int(a.split("=", 1)[1])
    try:
        return int(os.environ.get("VOX_PORT") or 8000)
    except ValueError:
        return 8000


def _serve(start_port, tries=60):
    """逐个端口尝试绑定，成功即用。

    为什么要在绑定处重试：Windows 的「端口排除段」（Hyper-V / WSL /
    Docker 预留）会让整段端口都返回 WSAEACCES，即使没有任何程序在监听。
    客户端侧的预判猜不到这段范围有多宽，只有真正 bind 一次才知道。
    """
    import socket as _socket
    for offset in range(tries):
        p = start_port + offset
        probe = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
        try:
            probe.bind(("127.0.0.1", p))
            probe.close()
        except OSError as e:
            probe.close()
            print(f"  端口 {p} 不可用（{e.errno}），试下一个", flush=True)
            continue
        # 让客户端知道最终用的是哪个端口
        print(f"VOX_PORT_ACTUAL={p}", flush=True)
        print(f"监听端口 {p}", flush=True)
        import uvicorn as _uvicorn
        _uvicorn.run(app, host="127.0.0.1", port=p)
        return
    print("找不到可用端口，请检查系统端口排除设置", flush=True)
    sys.exit(1)


if __name__ == "__main__":
    _serve(_resolve_port())
