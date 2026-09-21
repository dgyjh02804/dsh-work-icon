"""从整屏抓图裁出图标区域, 便于肉眼/视觉模型核对白底与深底表现。"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
# 图标窗口 rect=(600,400,480x480); 外扩 60px 显示背景
BOX = (540, 340, 1140, 940)

for name in ("raw_el_white.png", "raw_el_dark.png"):
    p = HERE / name
    if not p.exists():
        continue
    im = Image.open(p).convert("RGB")
    im.crop(BOX).save(HERE / name.replace("raw_el_", "electron_crop_"))
    print(f"{name} -> electron_crop_{name.replace('raw_el_', '')} box={BOX}")
