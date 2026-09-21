"""验证: 该置顶窗口能否被强行拉到前台(WS_EX_NOACTIVATE 的 API 级检验)。"""
from __future__ import annotations

import ctypes
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PyQt6 import QtCore, QtWidgets  # noqa: E402
from ark_core import ArkCore  # noqa: E402

app = QtWidgets.QApplication(sys.argv)
u = ctypes.WinDLL("user32", use_last_error=True)
u.GetForegroundWindow.restype = ctypes.c_void_p
u.GetForegroundWindow.argtypes = []
u.SetForegroundWindow.restype = ctypes.c_bool
u.SetForegroundWindow.argtypes = [ctypes.c_void_p]

plain = QtWidgets.QWidget()
plain.setWindowTitle("probe plain window")
plain.setGeometry(80, 80, 320, 200)
plain.show()
core = ArkCore(Path(__file__).resolve().parent / "ark_layout_probe.json", 3.0, True)
core.move(600, 320)
core.show()


def probe() -> None:
    pw, cw = int(plain.winId()), int(core.winId())
    u.SetForegroundWindow(ctypes.c_void_p(pw))
    app.processEvents()
    fg1 = int(u.GetForegroundWindow() or 0)
    u.SetForegroundWindow(ctypes.c_void_p(cw))
    app.processEvents()
    fg2 = int(u.GetForegroundWindow() or 0)
    print(f"plain_hwnd=0x{pw:X} core_hwnd=0x{cw:X}")
    print(f"step1 SetForegroundWindow(plain) -> fg=0x{fg1:X} plain_is_fg={fg1 == pw}")
    print(f"step2 SetForegroundWindow(core)  -> fg=0x{fg2:X} "
          f"core_refused={fg2 != cw} plain_still_fg={fg2 == pw}")
    app.quit()


QtCore.QTimer.singleShot(1200, probe)
app.exec()
