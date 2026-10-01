"""应用图标生成器：浅纸底 + 黑墨（V 在上、声波在下）

为什么有这个文件
- 之前的图标是**浏览器截图**（300×300，四角纯白、边缘带滚动条灰边，无透明通道），
  而且 assets/icons 那套也没有 alpha，圆角外是真的白像素 —— 表现为"图标有白边"。
- 本脚本直接从形状重绘，保证：四角透明、边缘无白描边、各尺寸单独渲染（不是缩放截图）。

设计参数（改这里就能调整图标）
- PAPER 宣纸白 #faf8f3；INK 墨色 #16130f
- V：笔画宽 13.2%、顶点 y=19.5%、笔锋 y=52.0%、左右张开 27.5%
- 声波：5 条竖条，宽度 7.0%、间距 5.0%、基线 y=78.2%、最高条高 24.5%
- 圆角半径 = 边长 23.4%；遮罩内收 2px（去掉设计自带的 1px 亮描边）

用法
    python 图标生成.py                # 输出到本目录
    python 图标生成.py <输出目录>      # 输出到指定目录
产物
    app-icon-{512,256,128,64,48,32,24,16}.png
    app-icon.png（等同 256）
    app-icon.ico（内含 16/24/32/48/64/128/256 七档，PNG 压缩）
说明
    依赖 Pillow（pip install pillow）。生成后需重新打包（npm run build:win）
    才会进入安装包；Windows 桌面/任务栏图标有缓存，装完可能要刷新才更新。
"""
from PIL import Image, ImageDraw
import os, sys, struct, io

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
SIZES = [512, 256, 128, 64, 48, 32, 24, 16]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
SS = 4                      # 超采样倍数（抗锯齿）
RADIUS_RATIO = 0.234        # 圆角半径 / 边长
INSET_PX = 2.0              # 遮罩内收，削掉边缘亮描边

INK = (22, 19, 15, 255)         # 墨
PAPER = (250, 248, 243, 255)    # 宣纸


def rounded_mask(size, radius_ratio=RADIUS_RATIO, inset_px=INSET_PX, ss=SS):
    """圆角遮罩：ss 倍超采样后降采样，边缘平滑无锯齿；四角完全透明"""
    big = size * ss
    m = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(m)
    r = int(round(big * radius_ratio))
    off = int(round(inset_px * ss))
    d.rounded_rectangle([off, off, big - 1 - off, big - 1 - off],
                        radius=max(0, r - off), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def draw_icon(size):
    S = size * SS
    im = Image.new("RGBA", (S, S), PAPER)
    d = ImageDraw.Draw(im)
    cx = S / 2

    # 黑墨 V：两笔，笔锋收在一点
    lw = S * 0.132
    top, bot, spread = S * 0.195, S * 0.520, S * 0.275
    pts = [(cx - spread, top), (cx, bot), (cx + spread, top)]
    d.line([pts[0], pts[1]], fill=INK, width=int(lw))
    d.line([pts[2], pts[1]], fill=INK, width=int(lw))
    r = lw / 2
    for (x, y) in pts:
        d.ellipse([x - r, y - r, x + r, y + r], fill=INK)

    # 黑墨声波：五条竖条，与 V 尖留出安全间距（16px 下仍能分辨）
    n = 5
    frac = [0.34, 0.64, 1.0, 0.60, 0.28]
    bw = S * 0.070
    gap = S * 0.050
    total = n * bw + (n - 1) * gap
    x0 = (S - total) / 2
    base = S * 0.782
    maxh = S * 0.245
    for i, f in enumerate(frac):
        hh = maxh * f
        x = x0 + i * (bw + gap)
        d.rounded_rectangle([x, base - hh / 2, x + bw, base + hh / 2],
                            radius=bw / 2, fill=INK)

    im = im.resize((size, size), Image.LANCZOS)
    im.putalpha(rounded_mask(size))
    return im


def build_ico(path, items):
    """把多档 PNG 打进一个 .ico（ICONDIR + 目录项 + PNG 数据；256 记作 0）"""
    n = len(items)
    header = struct.pack("<HHH", 0, 1, n)
    dirs, blobs, offset = b"", [], 6 + 16 * n
    for size, im in items:
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        data = buf.getvalue()
        dirs += struct.pack("<BBBBHHII",
                            size if size < 256 else 0, size if size < 256 else 0,
                            0, 0, 1, 32, len(data), offset)
        offset += len(data)
        blobs.append(data)
    with open(path, "wb") as f:
        f.write(header + dirs + b"".join(blobs))


os.makedirs(OUT, exist_ok=True)
made = {}
for s in SIZES:
    im = draw_icon(s)
    made[s] = im
    im.save(os.path.join(OUT, f"app-icon-{s}.png"), "PNG", optimize=True)
    print(f"[out] app-icon-{s}.png")
made[256].save(os.path.join(OUT, "app-icon.png"), "PNG", optimize=True)
print("[out] app-icon.png (=256)")
build_ico(os.path.join(OUT, "app-icon.ico"), [(s, made[s]) for s in ICO_SIZES])
print(f"[out] app-icon.ico ({ICO_SIZES})")
print("[done]", OUT)
