"""定位离屏抓图里 "外框非透明" 的像素, 判断是渲染缺陷还是标签溢出。"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
name = sys.argv[1] if len(sys.argv) > 1 else "shot_headless_140.png"
im = Image.open(HERE / name).convert("RGBA")
w, h = im.size
px = im.load()
print(f"{name}: {w}x{h}")

hits = [(x, y, px[x, y]) for y in range(h) for x in range(w)
        if (x < 2 or x >= w - 2 or y < 2 or y >= h - 2) and px[x, y][3] > 0]
print(f"outer-frame non-transparent pixels: {len(hits)}")
if hits:
    xs = [p[0] for p in hits]
    ys = [p[1] for p in hits]
    print(f"  bbox=({min(xs)},{min(ys)})-({max(xs)},{max(ys)})")
    from collections import Counter
    print(f"  colors={Counter(str(p[2]) for p in hits).most_common(4)}")
    print(f"  first5={hits[:5]}")

# 逐行扫描 alpha>0 的横向范围, 看是否贴着边缘
print("rows with alpha>0 at extremes:")
for y in (0, 1, 2, h - 3, h - 2, h - 1):
    row = [x for x in range(w) if px[x, y][3] > 0]
    print(f"  y={y}: n={len(row)} first={row[0] if row else None} last={row[-1] if row else None}")
for x in (0, 1, w - 2, w - 1):
    col = [y for y in range(h) if px[x, y][3] > 0]
    print(f"  x={x}: n={len(col)} first={col[0] if col else None} last={col[-1] if col else None}")

# 内容包围盒 (alpha>8)
cnt = [(x, y) for y in range(h) for x in range(w) if px[x, y][3] > 8]
xs = [p[0] for p in cnt]
ys = [p[1] for p in cnt]
print(f"content bbox (alpha>8): ({min(xs)},{min(ys)})-({max(xs)},{max(ys)})")
