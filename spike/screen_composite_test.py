"""真机 DWM 合成验证: 在自己的纯白/纯深色背景窗口之上叠一个 ArkCore,
然后抓屏裁剪出图标区域, 检验是否出现黑色方块底。

背景窗口铺满整个屏幕 -> 抓屏内容 100% 是自己的像素, 不涉及用户桌面内容。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PyQt6 import QtCore, QtGui, QtWidgets  # noqa: E402
from ark_core import ArkCore  # noqa: E402

HERE = Path(__file__).resolve().parent
app = QtWidgets.QApplication(sys.argv)
scr = app.primaryScreen()
dpr = scr.devicePixelRatio()
full = scr.geometry()
core_pos = (300, 200)
grab_box = (core_pos[0] - 60, core_pos[1] - 60, 360, 360)  # 逻辑坐标

bg = QtWidgets.QWidget()
bg.setWindowFlags(QtCore.Qt.WindowType.FramelessWindowHint
                  | QtCore.Qt.WindowType.WindowStaysOnTopHint)
bg.setGeometry(full)
core = ArkCore(HERE / "ark_layout_probe.json", 3.0, True)
core.move(*core_pos)
bg.showFullScreen()
bg.raise_()
core.show()
core.raise_()
results = []


def capture(tag: str, color: str) -> None:
    bg.setStyleSheet(f"background-color: {color};")
    bg.repaint()
    core.raise_()
    app.processEvents()
    QtCore.QThread.msleep(250)
    app.processEvents()
    pix = scr.grabWindow(0)
    img = pix.toImage()
    full_png = HERE / f"_raw_{tag}.png"
    img.save(str(full_png))
    x, y, w, h = [int(v * dpr) for v in grab_box]
    cropped = img.copy(x, y, w, h)
    out = HERE / f"screen_{tag}.png"
    cropped.save(str(out))
    full_png.unlink(missing_ok=True)
    corners = [cropped.pixelColor(px, py).name() for px, py in
               ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    mid_edge = cropped.pixelColor(w // 2, 3).name()
    results.append(f"{tag}: bg={color} crop={w}x{h} corners={corners} top_edge={mid_edge} -> {out.name}")
    print(results[-1], flush=True)


QtCore.QTimer.singleShot(1500, lambda: capture("white", "#ffffff"))
QtCore.QTimer.singleShot(3000, lambda: capture("dark", "#181818"))
QtCore.QTimer.singleShot(4200, app.quit)
app.exec()
for line in results:
    print("RESULT " + line, flush=True)
print(f"dpr={dpr} screen={full.width()}x{full.height()} window_logical={core.width()}x{core.height()}")
