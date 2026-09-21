"""分析真机抓图: 图标外围边框带内是否出现非背景色像素(即黑方块底)。"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent

for name, bg in (("screen_white.png", (255, 255, 255)), ("screen_dark.png", (24, 24, 24))):
    im = Image.open(HERE / name).convert("RGB")
    w, h = im.size
    px = im.load()
    band = 60
    bad = []
    for y in range(h):
        for x in range(w):
            if x < band or x >= w - band or y < band or y >= h - band:
                r, g, b = px[x, y]
                if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 12:
                    bad.append((x, y, (r, g, b)))
    near_black = sum(1 for y in range(h) for x in range(w) if sum(px[x, y]) < 60)
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    verdict = "PASS(无黑底方块)" if not bad else "FAIL"
    print(f"{name}: size={w}x{h} outer_band={band}px non_bg_pixels={len(bad)} "
          f"corners={corners} near_black_total={near_black} verdict={verdict}")
    if bad:
        print(f"  first_bad={bad[:5]}")
