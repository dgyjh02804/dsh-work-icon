"""对比 --cache 与非 --cache 的渲染结果是否一致 (同一状态、同一抓图时刻)。"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent

a = Image.open(HERE / "shot_240_plain.png").convert("RGBA")
b = Image.open(HERE / "shot_240_cached.png").convert("RGBA")
print(f"sizes: plain={a.size} cached={b.size}")

pa, pb = a.load(), b.load()
w, h = a.size
diff_px = 0
alpha_delta_sum = 0
max_alpha_delta = 0
for y in range(h):
    for x in range(w):
        ca, cb = pa[x, y], pb[x, y]
        d = sum(abs(ca[i] - cb[i]) for i in range(4))
        if d > 24:
            diff_px += 1
        ad = abs(ca[3] - cb[3])
        alpha_delta_sum += ad
        if ad > max_alpha_delta:
            max_alpha_delta = ad
total = w * h
print(f"pixels_differing(>24/1020)={diff_px} ({diff_px * 100 / total:.2f}%)")
print(f"mean_alpha_delta={alpha_delta_sum / total:.2f}  max_alpha_delta={max_alpha_delta}")

# 覆盖率(非全透明像素占比) 是结构一致性最直观的指标
cov_a = sum(1 for y in range(h) for x in range(w) if pa[x, y][3] > 8) * 100 / total
cov_b = sum(1 for y in range(h) for x in range(w) if pb[x, y][3] > 8) * 100 / total
print(f"coverage_plain={cov_a:.2f}%  coverage_cached={cov_b:.2f}%  delta={abs(cov_a - cov_b):.2f}pp")

# 并排图, 便于人工看
side = Image.new("RGBA", (w * 2 + 12, h), (24, 24, 28, 255))
side.alpha_composite(a, (0, 0))
side.alpha_composite(b, (w + 12, 0))
side.convert("RGB").save(HERE / "compare_cache_side_by_side.png")
print("wrote compare_cache_side_by_side.png (左=非缓存 右=缓存)")
