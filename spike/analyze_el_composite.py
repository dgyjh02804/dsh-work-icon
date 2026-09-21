"""Electron 真机 DWM 合成判定 (坐标从 <png>.rect 读取, 不硬编码)。

判据: 图标窗口矩形内 "页面上完全透明的区域" 必须精确显示背后的背景色。
若存在任何不透明底(黑块/白块), 大面积像素会偏离背景色且呈矩形分布。
分析会给出偏离像素的占比与包围盒 -> 鼠标指针之类的小色块可与窗口底区分开。
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent

CASES = [("raw_el_white.png", (255, 255, 255), "白底"),
         ("raw_el_dark.png", (24, 24, 24), "深底")]

for name, bg, label in CASES:
    png = HERE / name
    rect_file = HERE / (name + ".rect")
    if not rect_file.exists():
        print(f"{name}: missing rect file, skip")
        continue
    WX, WY, WW, WH = (int(v) for v in rect_file.read_text().split())
    im = Image.open(png).convert("RGB")
    px = im.load()

    # 窗口矩形内逐像素与背景色比较
    dev = []
    for y in range(WY, WY + WH):
        for x in range(WX, WX + WW):
            c = px[x, y]
            if abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2]) > 8:
                dev.append((x, y))
    total = WW * WH
    print(f"{name} [{label}] window=({WX},{WY},{WW}x{WH}) bg={bg}")
    print(f"  deviating_pixels={len(dev)} / {total} ({len(dev) * 100 / total:.1f}%)")
    if dev:
        xs = [p[0] for p in dev]
        ys = [p[1] for p in dev]
        print(f"  deviation_bbox=({min(xs)},{min(ys)})-({max(xs)},{max(ys)}) "
              f"size={max(xs) - min(xs) + 1}x{max(ys) - min(ys) + 1}")
    # 四角 (最容易被不透明底暴露的位置)
    corners = {k: px[x, y] for k, (x, y) in {
        "TL": (WX + 2, WY + 2), "TR": (WX + WW - 3, WY + 2),
        "BL": (WX + 2, WY + WH - 3), "BR": (WX + WW - 3, WY + WH - 3)}.items()}
    ok = all(sum(abs(c[i] - bg[i]) for i in range(3)) <= 8 for c in corners.values())
    print(f"  corners={corners} corners_match_bg={ok}")
    print(f"  VERDICT={'PASS' if ok else 'FAIL'}")
    sys.stdout.flush()
