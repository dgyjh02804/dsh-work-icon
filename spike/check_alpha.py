"""校验 ark_core 截图是否真·逐像素透明(而不是黑底方块)。

用法: python check_alpha.py shot.png
输出: 透明像素占比 / 四角 alpha / 最大不透明像素数, 并合成到白底与深色底各存一张 PNG。
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

src = Path(sys.argv[1]).resolve()
img = Image.open(src).convert("RGBA")
w, h = img.size
px = img.load()

total = w * h
transparent = 0
semi = 0
opaque = 0
for y in range(h):
    for x in range(w):
        a = px[x, y][3]
        if a == 0:
            transparent += 1
        elif a < 255:
            semi += 1
        else:
            opaque += 1

corners = {n: px[x, y] for n, (x, y) in {
    "TL": (0, 0), "TR": (w - 1, 0), "BL": (0, h - 1), "BR": (w - 1, h - 1)}.items()}
center = px[w // 2, h // 2]

print(f"file={src.name} size={w}x{h} mode={img.mode}")
print(f"fully_transparent={transparent} ({transparent * 100 / total:.1f}%)")
print(f"semi_transparent={semi} ({semi * 100 / total:.1f}%)")
print(f"fully_opaque={opaque} ({opaque * 100 / total:.1f}%)")
print(f"corners={corners}")
print(f"center_rgba={center}")

# 合成验证: 如果图标真的带 alpha, 合成到白底后角落应接近纯白, 不出现黑块
for name, bg in (("white", (255, 255, 255, 255)), ("dark", (24, 24, 28, 255))):
    canvas = Image.new("RGBA", img.size, bg)
    canvas.alpha_composite(img)
    out = src.with_name(f"{src.stem}_on_{name}.png")
    canvas.convert("RGB").save(out)
    print(f"composited_on_{name} -> {out.name} corner={canvas.convert('RGB').getpixel((0, 0))}")

# 真正判据(与设计无关): 最外 2px 边框必须完全 alpha=0 -> 不存在任何不透明矩形底/黑框
frame_max = max(px[x, y][3] for y in range(h) for x in range(w)
                if x < 2 or x >= w - 2 or y < 2 or y >= h - 2)
print(f"outer_frame_max_alpha={frame_max} (必须为 0, 否则说明有矩形底)")

verdict = "PASS" if frame_max == 0 and transparent > 0.05 * total else "FAIL"
print(f"alpha_verdict={verdict}  "
      f"(判据: 外框 max alpha==0 且全透明像素>5%; 上一版 30% 阈值是按 Qt 图标调的, H2 光晕更大不适用)")
