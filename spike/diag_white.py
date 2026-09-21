"""定位 screen_white.png 中偏离纯白的像素分布, 判断是"黑方块"还是背景窗口自身边框/渲染差异。"""
from __future__ import annotations

from collections import Counter
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
im = Image.open(HERE / "screen_white.png").convert("RGB")
w, h = im.size
px = im.load()

cnt = Counter(px[x, y] for y in range(h) for x in range(w))
print("top 8 colors:", cnt.most_common(8))

dark = [(x, y) for y in range(h) for x in range(w) if sum(px[x, y]) < 60]
if dark:
    xs = [p[0] for p in dark]
    ys = [p[1] for p in dark]
    print(f"near_black count={len(dark)} bbox=({min(xs)},{min(ys)})-({max(xs)},{max(ys)})")
    print("samples:", [(p, px[p[0], p[1]]) for p in dark[:3]])
    # 图标中心在裁剪图 (360,360), 半径 224 物理像素外即是"图标外"
    outside = [p for p in dark if ((p[0] - 360) ** 2 + (p[1] - 360) ** 2) ** 0.5 > 240]
    print(f"near_black_outside_icon_radius240={len(outside)}")

band = 60
notwhite = [(x, y) for y in range(h) for x in range(w)
            if (x < band or x >= w - band or y < band or y >= h - band)
            and px[x, y] != (255, 255, 255)]
if notwhite:
    xs = [p[0] for p in notwhite]
    ys = [p[1] for p in notwhite]
    print(f"band_not_pure_white={len(notwhite)} bbox=({min(xs)},{min(ys)})-({max(xs)},{max(ys)})")
    print("their colors:", Counter(px[x, y] for x, y in notwhite).most_common(4))
