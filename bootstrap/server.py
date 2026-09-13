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
from voxcpm import VoxCPM
import soundfile as sf

# ========== 路径与配置 ==========
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, 'pretrained_models', 'VoxCPM2')
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

# ---------- 模型自动下载 ----------
def ensure_wav(path, sample_rate=16000):
    """把任意格式的音频转成模型能稳定读取的 16kHz 单声道 WAV。

    为什么必须转：Windows 上 librosa / soundfile 对 m4a(AAC)、部分 mp3 解码不稳定，
    直接喂原始字节只会得到
        PySoundFile failed. Trying audioread instead.
    然后静音或报错。早期版本的总结文档里记录过这个坑，但转码逻辑在重构时丢了。
    """
    if not path or not os.path.exists(path):
        return path
    if path.lower().endswith('.wav'):
        # 已是 wav，但采样率/声道可能不合规，仍统一转一遍（很快）
        pass
    out = tempfile.NamedTemporaryFile(suffix='.wav', delete=False).name
    try:
        subprocess.run(
            ['ffmpeg', '-y', '-i', path,
             '-ar', str(sample_rate), '-ac', '1', '-sample_fmt', 's16', out],
            check=True, capture_output=True, timeout=120
        )
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
    all_presets = get_all_presets()
    desc = all_presets.get(style_preset, "")
    if desc:
        return f"{desc} {user_text}"
    return user_text

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
                from modelscope import snapshot_download
                os.makedirs(MODEL_PATH, exist_ok=True)
                snapshot_download("OpenBMB/VoxCPM2", local_dir=MODEL_PATH)
            finally:
                stop.set()
            if not os.path.exists(MODEL_WEIGHT):
                raise RuntimeError("模型下载后仍未找到 model.safetensors，请检查网络或磁盘空间")
            _phase.update(progress=1.0, downloaded=_dir_size(MODEL_PATH))
            print("模型下载完成。", flush=True)

        # 2) 加载
        _phase.update(phase='loading', message='正在加载模型')
        print("正在加载 VoxCPM2 模型...", flush=True)
        _t0 = time.time()
        # optimize 自 2.0.3 起默认 True（推理提速的关键开关），这里显式写出，
        # 免得将来默认值变化时静默变慢
        _model = VoxCPM.from_pretrained(
            MODEL_PATH,
            load_denoiser=False,
            optimize=True,
        )
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
        "expected_mb": int(MODEL_SIZE_HINT / 1024 / 1024),
        "error": model_error,
        "elapsed_ms": int((time.time() - _model_started_at) * 1000),
        "engine": _engine_info(),
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
    return {"status": "ok"}

@app.post("/api/update_preset")
async def update_preset(
    old_name: str = Form(...),
    new_name: str = Form(...),
    desc: str = Form(""),
    voice: UploadFile = File(None)
):
    """修改预设：名称、描述、声纹"""
    presets = load_custom_presets()
    if old_name not in presets:
        return JSONResponse({"error": "预设不存在"}, status_code=404)

    # 删除旧声纹（所有扩展名）
    for ext in ['.wav', '.mp3', '.m4a', '.flac']:
        old_voice_path = os.path.join(VOICE_PROFILES_DIR, old_name + ext)
        if os.path.exists(old_voice_path):
            os.unlink(old_voice_path)

    # 如果名称变了，移除旧条目
    if old_name != new_name:
        del presets[old_name]
    presets[new_name] = desc
    save_custom_presets(presets)

    # 保存新声纹
    if voice and voice.filename:
        ext = os.path.splitext(voice.filename)[1] or ".wav"
        allowed_ext = ['.wav', '.mp3', '.m4a', '.flac']
        if ext.lower() not in allowed_ext:
            return JSONResponse({"error": f"不支持的音频格式: {ext}"}, status_code=400)
        voice_path = os.path.join(VOICE_PROFILES_DIR, new_name + ext)
        with open(voice_path, "wb") as f:
            f.write(await voice.read())
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
    steps: int = Form(10)
):
    full_text = combine_text(text, style)
    try:
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
    prompt_path = ensure_wav(_praw.name)      # 同上，格式统一
    ref_path = None
    if ref_audio:
        ref_f = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        ref_f.write(await ref_audio.read())
        ref_f.close()
        ref_path = ensure_wav(ref_f.name)
    try:
        wav = model.generate(
            text=text,
            prompt_wav_path=prompt_path.name,
            prompt_text=prompt_text,
            reference_wav_path=ref_path,
            cfg_value=cfg,
            inference_timesteps=steps,
        )
        filename = save_audio_and_record('hifi', text, wav)
        os.unlink(prompt_path.name)
        if ref_path: os.unlink(ref_path)
        cleanup_gpu_memory()
        return FileResponse(os.path.join(HISTORY_DIR, filename), media_type="audio/wav", filename=filename)
    except Exception as e:
        if os.path.exists(prompt_path.name): os.unlink(prompt_path.name)
        if ref_path and os.path.exists(ref_path): os.unlink(ref_path)
        cleanup_gpu_memory()
        return JSONResponse({"error": str(e)}, status_code=500)

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
        cmd = ["ffmpeg", "-y", "-i", input_path, "-ar", str(sample_rate), "-ab", bitrate, "-vn", output_path]
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        os.unlink(input_path)
        return JSONResponse({"error": f"转换失败: {e.stderr.decode()}"}, status_code=500)
    os.unlink(input_path)
    return FileResponse(output_path, media_type=f"audio/{target_format}", filename=f"converted.{target_format}")

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
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)