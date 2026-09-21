"""诊断: 打印整屏主色与图标窗口四角颜色, 判断背景窗口当前实际颜色。"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent

for name in sys.argv[1:]:
    p = HERE / name
    if not p.exists():
        print(f"{name}: missing")
        continue
    rp = HERE / (name + ".rect")
    rect = tuple(int(v) for v in rp.read_text().split()) if rp.exists() else None
    im = Image.open(p).convert("RGB")
    px = im.load()
    c = Counter(px[x, y] for y in range(0, 1720, 20) for x in range(0, 2880, 20))
    print(f"{name}: size={im.size} top_colors={c.most_common(3)}")
    if rect:
        wx, wy, ww, wh = rect
        corners = [px[wx + 3, wy + 3], px[wx + ww - 4, wy + 3],
                   px[wx + 3, wy + wh - 4], px[wx + ww - 4, wy + wh - 4]]
        center = px[wx + ww // 2, wy + wh // 2]
        print(f"  rect={rect} corners={corners} center={center}")
