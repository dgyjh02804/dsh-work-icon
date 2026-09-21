"""方舟核心(Ark Core) —— DSH 悬浮状态图标 原生置顶窗口 spike。

验证目标:
  1. 无边框 / 置顶 / 逐像素透明(Qt WA_TranslucentBackground) 的悬浮窗
  2. 不抢焦点 (WS_EX_NOACTIVATE + WA_ShowWithoutActivating + Qt.Tool)
  3. 鼠标拖动 + 位置持久化 (JSON)
  4. QPainter 手绘: 同心发光环 + 中心能量核 + 粒子云核, QTimer ~60fps
  5. 4 个状态自动循环 (空闲/思考/执行/待确认), 每 3 秒切换

只读参考实现: dsh-dafeiyu (PySide6 + QWidget + JSONL over stdio)。
本文件不依赖 dafeiyu 的任何文件。
"""
from __future__ import annotations

import argparse
import ctypes
import json
import math
import os
import sys
import time
from pathlib import Path

PROC_T0 = time.perf_counter()   # 进程启动(任何 Qt 导入之前) → 首帧, 用于启动耗时对比

# ---------------------------------------------------------------- Qt binding
# 优先 PyQt6(本机已装), 可用 DSH_SPIKE_QT=pyside6 强制走 PySide6。
BINDING = None
_want = os.environ.get("DSH_SPIKE_QT", "").strip().lower()
_order = ["pyside6", "pyqt6"] if _want.startswith("pyside") else ["pyqt6", "pyside6"]
for _name in _order:
    try:
        if _name == "pyqt6":
            from PyQt6 import QtCore, QtGui, QtWidgets  # type: ignore
        else:
            from PySide6 import QtCore, QtGui, QtWidgets  # type: ignore
        BINDING = _name
        break
    except ImportError:
        continue

if BINDING is None:
    print("FATAL: neither PyQt6 nor PySide6 importable", file=sys.stderr)
    raise SystemExit(2)

Qt = QtCore.Qt
QPoint = QtCore.QPoint
QPointF = QtCore.QPointF
QRectF = QtCore.QRectF
QTimer = QtCore.QTimer
QWidget = QtWidgets.QWidget
QApplication = QtWidgets.QApplication
QPainter = QtGui.QPainter
QColor = QtGui.QColor
QPen = QtGui.QPen
QRadialGradient = QtGui.QRadialGradient
QPixmap = QtGui.QPixmap
QFont = QtGui.QFont

LOG_HANDLE = None


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    if LOG_HANDLE is not None:
        LOG_HANDLE.write(line + "\n")
        LOG_HANDLE.flush()


# ---------------------------------------------------------------- 状态定义
# state -> (中文名, 主色, 亮色, 转速倍率, 动效)
STATES = [
    ("IDLE",     "空闲",   "#1E6E7A", "#39B8C8", 0.30, "slow"),
    ("THINKING", "思考",   "#2E7DFF", "#8FD8FF", 1.00, "orbit"),
    ("WORKING",  "执行",   "#00E5A0", "#8CFFD8", 2.10, "fast"),
    ("WAITING",  "待确认", "#FFA51F", "#FFE79A", 0.55, "pulse"),
]

WIN = 240          # 逻辑像素窗口边长
CX = CY = WIN / 2.0
PARTICLES = 96     # 粒子云核粒子数
FRAME_MS = 16      # ~62.5 fps 目标


def sphere_points(n: int) -> list[tuple[float, float, float]]:
    """斐波那契球面均匀点阵(单位球)。"""
    ga = math.pi * (3.0 - math.sqrt(5.0))
    out = []
    for i in range(n):
        y = 1.0 - (i / (n - 1)) * 2.0
        r = math.sqrt(max(0.0, 1.0 - y * y))
        th = ga * i
        out.append((math.cos(th) * r, y, math.sin(th) * r))
    return out


SPHERE = sphere_points(PARTICLES)


class ArkCore(QWidget):
    def __init__(self, layout_path: Path, cycle_s: float, show_label: bool,
                 size: int = WIN, cache: bool = False, frame_ms: int = FRAME_MS,
                 headless: bool = False, corner: bool = True) -> None:
        super().__init__()
        self.headless = headless
        self.render_ms = 0.0
        self.renders = 0
        self.layout_path = layout_path
        self.cycle_s = cycle_s
        self.show_label = show_label
        self.S = float(size)
        self.k = self.S / float(WIN)      # 设计稿以 240 为基准, 绘制时整体缩放
        self.cache = cache
        self.dpr = 1.0
        try:
            self.dpr = float(QApplication.primaryScreen().devicePixelRatio()) or 1.0
        except Exception:
            self.dpr = 1.0
        self._layers: dict[str, object] = {}
        self._brushes: dict[tuple, object] = {}
        self.t0 = time.perf_counter()
        self.frames = 0
        self.fps_mark = self.t0
        self.fps_window = 0
        self.last_state = None
        self.state_changes = 0
        self._grad_cache: dict[str, object] = {}
        self._exstyle_done = False
        self._first_paint = False
        self._drag_from = None
        self._win_from = None
        self._dragging = False

        self.setWindowTitle("DSH 方舟核心")
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool                      # 不占任务栏
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating, True)
        self.setFixedSize(int(self.S), int(self.S))

        if self.headless:
            self.move(0, 0)
            geo = (0, 0)
        elif corner:
            scr = QApplication.primaryScreen().availableGeometry()
            geo = (scr.right() - int(self.S) - 16, scr.bottom() - int(self.S) - 16)
            self.move(*geo)
        else:
            geo = self._restore_position()
        log(f"binding={BINDING} size={int(self.S)}px cache={cache} headless={headless} "
            f"start_pos=({geo[0]},{geo[1]}) cycle={cycle_s}s particles={PARTICLES} "
            f"show_label={show_label}")

        self.timer = QTimer(self)
        self.timer.timeout.connect(self._tick)
        self.timer.start(int(frame_ms))

    # ------------------------------------------------------------ 位置持久化
    def _restore_position(self) -> tuple[int, int]:
        pos = None
        try:
            data = json.loads(self.layout_path.read_text(encoding="utf-8"))
            x, y = data.get("x"), data.get("y")
            if isinstance(x, int) and isinstance(y, int):
                pos = (x, y)
        except (OSError, ValueError):
            pos = None
        if pos is None:
            scr = QApplication.primaryScreen().availableGeometry()
            pos = (scr.right() - int(self.S) - 40, scr.top() + 80)
            log("no saved layout -> default position")
        else:
            log(f"restored layout -> ({pos[0]},{pos[1]})")
        self.move(*pos)
        return pos

    def _save_position(self) -> None:
        payload = {"version": 1, "x": self.x(), "y": self.y()}
        try:
            self.layout_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.layout_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, self.layout_path)
            log(f"saved layout -> ({self.x()},{self.y()})")
        except OSError as exc:
            log(f"WARN save layout failed: {exc}")

    # ------------------------------------------------------- 不抢焦点 (Win32)
    def showEvent(self, event) -> None:  # noqa: N802
        super().showEvent(event)
        if self._exstyle_done or sys.platform != "win32":
            return
        self._exstyle_done = True
        GWL_EXSTYLE = -20
        WS_EX_NOACTIVATE = 0x08000000
        WS_EX_TOOLWINDOW = 0x00000080
        try:
            user32 = ctypes.WinDLL("user32", use_last_error=True)
            get = user32.GetWindowLongPtrW
            get.argtypes = [ctypes.c_void_p, ctypes.c_int]
            get.restype = ctypes.c_ssize_t
            setg = user32.SetWindowLongPtrW
            setg.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_ssize_t]
            setg.restype = ctypes.c_ssize_t
            hwnd = int(self.winId())
            before = get(ctypes.c_void_p(hwnd), GWL_EXSTYLE)
            after = setg(ctypes.c_void_p(hwnd), GWL_EXSTYLE,
                         before | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW)
            now = get(ctypes.c_void_p(hwnd), GWL_EXSTYLE)
            log(f"hwnd=0x{hwnd:X} exstyle 0x{before:08X} -> 0x{now:08X} "
                f"NOACTIVATE={'ON' if now & WS_EX_NOACTIVATE else 'OFF'} "
                f"TOOLWINDOW={'ON' if now & WS_EX_TOOLWINDOW else 'OFF'}")
        except Exception as exc:  # pragma: no cover
            log(f"WARN SetWindowLongPtrW failed: {exc}")

    # ---------------------------------------------------------------- 拖动
    def mousePressEvent(self, event) -> None:  # noqa: N802
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_from = event.globalPosition().toPoint()
            self._win_from = self.pos()
            self._dragging = False

    def mouseMoveEvent(self, event) -> None:  # noqa: N802
        if self._drag_from is None or self._win_from is None:
            return
        cur = event.globalPosition().toPoint()
        if not self._dragging and (cur - self._drag_from).manhattanLength() > 4:
            self._dragging = True
        if self._dragging:
            self.move(self._win_from + (cur - self._drag_from))

    def mouseReleaseEvent(self, event) -> None:  # noqa: N802
        if event.button() == Qt.MouseButton.LeftButton and self._dragging:
            self._save_position()
        self._drag_from = None
        self._win_from = None
        self._dragging = False

    def closeEvent(self, event) -> None:  # noqa: N802
        self._save_position()
        log("window closing")
        super().closeEvent(event)

    # ---------------------------------------------------------------- 帧循环
    def _tick(self) -> None:
        now = time.perf_counter()
        self.frames += 1
        self.fps_window += 1
        if now - self.fps_mark >= 2.0:
            fps = self.fps_window / (now - self.fps_mark)
            scr = self.screen() or QApplication.primaryScreen()
            extra = ""
            if self.headless and self.renders:
                extra = f" offscreen_render_avg={self.render_ms / self.renders:.2f}ms renders={self.renders}"
            log(f"fps={fps:.1f} frames={self.frames} state={self.last_state} "
                f"size={int(self.S)} cache={self.cache} headless={self.headless} "
                f"pos=({self.x()},{self.y()}) dpr={scr.devicePixelRatio()} "
                f"geom={self.width()}x{self.height()}{extra}")
            self.fps_mark = now
            self.fps_window = 0
        if self.headless:
            # 离屏: 不 show(), 每帧显式 render 一次, 既验证绘制路径也给出离屏帧耗时
            t0 = time.perf_counter()
            pm = self.grab()
            self.render_ms += (time.perf_counter() - t0) * 1000.0
            self.renders += 1
            if pm.isNull():
                log("WARN offscreen grab returned null pixmap")
        else:
            self.update()

    def _state_now(self) -> tuple:
        elapsed = time.perf_counter() - self.t0
        idx = int(elapsed // self.cycle_s) % len(STATES)
        entry = STATES[idx]
        if entry[0] != self.last_state:
            self.state_changes += 1
            log(f"STATE -> {entry[0]} ({entry[1]})  [switch #{self.state_changes}]")
            self.last_state = entry[0]
        return entry, elapsed

    # ---------------------------------------------------------------- 绘制
    def _glow(self, key: str, color: str, radius: float, peak: int):
        gk = f"{key}|{color}|{radius:.1f}|{peak}"
        g = self._grad_cache.get(gk)
        if g is None:
            g = QRadialGradient(QPointF(CX, CY), radius)
            c = QColor(color)
            c.setAlpha(peak)
            g.setColorAt(0.0, c)
            mid = QColor(color)
            mid.setAlpha(int(peak * 0.35))
            g.setColorAt(0.55, mid)
            edge = QColor(color)
            edge.setAlpha(0)
            g.setColorAt(1.0, edge)
            self._grad_cache[gk] = g
        return g

    # ------------------------------------------- 预渲染图层 (静态层缓存, --cache)
    def _layer_px(self) -> int:
        return max(1, int(round(WIN * self.k * self.dpr)))

    def _brush(self, key: str, color: str, alpha: int):
        ck = (key, color, alpha)
        b = self._brushes.get(ck)
        if b is None:
            c = QColor(color)
            c.setAlpha(alpha)
            self._brushes[ck] = c
            b = c
        return b

    def _new_layer(self):
        pm = QPixmap(self._layer_px(), self._layer_px())
        pm.fill(Qt.GlobalColor.transparent)
        pm.setDevicePixelRatio(self.dpr)
        q = QPainter(pm)
        q.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        q.scale(self.k, self.k)
        return pm, q

    def _layer(self, key: str, build):
        pm = self._layers.get(key)
        if pm is None:
            pm = build()
            self._layers[key] = pm
        return pm

    def _build_bloom(self, base: str, radius: float):
        pm, q = self._new_layer()
        q.setBrush(self._glow("bloom", base, radius, 78))
        q.setPen(Qt.PenStyle.NoPen)
        q.drawEllipse(QPointF(CX, CY), radius, radius)
        q.end()
        return pm

    def _build_tick(self, color: str):
        pm, q = self._new_layer()
        col = QColor(color)
        col.setAlpha(90)
        pen = QPen(col, 1.0)
        pen.setCapStyle(Qt.PenCapStyle.FlatCap)
        q.setPen(pen)
        rect = QRectF(CX - 96.0, CY - 96.0, 192.0, 192.0)
        span = 360.0 / 60 - 3.0
        for i in range(60):
            q.drawArc(rect, int((90.0 - i * 6.0) * 16), int(span * 16))
        q.end()
        return pm

    def _build_core(self, bright: str, radius: float):
        pm, q = self._new_layer()
        q.setBrush(self._glow("core", bright, radius, 150))
        q.setPen(Qt.PenStyle.NoPen)
        q.drawEllipse(QPointF(CX, CY), radius, radius)
        q.end()
        return pm

    def paintEvent(self, event) -> None:  # noqa: N802
        (name, cn, base, bright, speed, motion), t = self._state_now()
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing, True)

        if not self._first_paint:
            self._first_paint = True
            self.dpr = float(self.devicePixelRatioF()) or 1.0
            log(f"first_paint_ms={(time.perf_counter() - PROC_T0) * 1000:.0f} dpr={self.dpr}")

        # 关键: 用 Source 模式清空整块画布 -> 真·逐像素透明, 避免残影/黑底
        p.setCompositionMode(QPainter.CompositionMode.CompositionMode_Source)
        p.fillRect(self.rect(), Qt.GlobalColor.transparent)
        p.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceOver)

        base_c, bright_c = QColor(base), QColor(bright)
        ang = t * speed
        pulse = 0.5 + 0.5 * math.sin(t * 2.0)
        bloom = 1.0 + (0.18 * pulse if motion == "pulse" else 0.0)
        core_r = 26.0 if motion != "pulse" else 24.0 + 6.0 * pulse

        p.save()
        p.scale(self.k, self.k)          # 全部绘制在设计稿 240 坐标系里

        pq = int(pulse * 5.99) if motion == "pulse" else 0
        pqf = (pq + 0.5) / 6.0 if motion == "pulse" else 0.0

        # ---- 1. 外层光晕 (radial gradient, alpha 衰减到 0)
        if self.cache:
            b_rad = 112.0 * (1.0 + 0.18 * pqf)
            p.drawPixmap(0, 0, WIN, WIN,
                         self._layer(f"bloom|{name}|{pq}",
                                     lambda r=b_rad: self._build_bloom(base, r)))
        else:
            p.setBrush(self._glow("bloom", base, 112.0 * bloom, 78))
            p.setPen(Qt.PenStyle.NoPen)
            p.drawEllipse(QPointF(CX, CY), 112.0 * bloom, 112.0 * bloom)

        # ---- 2. 同心圆环 (3 层, 带缺口的分段弧, 反向旋转)
        def ring(radius: float, width: float, n_arc: int, gap_deg: float,
                 rot: float, color: QColor, alpha: int) -> None:
            col = QColor(color)
            col.setAlpha(alpha)
            pen = QPen(col, width)
            pen.setCapStyle(Qt.PenCapStyle.FlatCap)
            p.setPen(pen)
            span = 360.0 / n_arc - gap_deg
            for i in range(n_arc):
                a0 = rot + i * (360.0 / n_arc)
                rect = QRectF(CX - radius, CY - radius, radius * 2, radius * 2)
                p.drawArc(rect, int((90.0 - a0) * 16), int(span * 16))

        if self.cache:
            # 刻度环 60 段弧 -> 一次旋转 blit
            p.save()
            p.translate(CX, CY)
            p.rotate((ang * 12.0) % 360.0)
            p.translate(-CX, -CY)
            p.drawPixmap(0, 0, WIN, WIN, self._layer(f"tick|{name}",
                                                     lambda: self._build_tick(base)))
            p.restore()
        else:
            ring(96.0, 1.0, 60, 3.0, ang * 12, base_c, 90)             # 细密刻度环
        ring(84.0, 1.8, 3, 42.0, math.degrees(ang) * 1.0, bright_c, 210)
        ring(66.0, 2.6, 2, 78.0, -math.degrees(ang) * 1.6, base_c, 235)
        ring(50.0, 1.4, 4, 60.0, math.degrees(ang) * 2.4, bright_c, 150)

        # ---- 3. 粒子云核 (z 深度决定大小/透明度, 加色发光)
        p.setCompositionMode(QPainter.CompositionMode.CompositionMode_Plus)
        ca, sa = math.cos(ang * 1.5), math.sin(ang * 1.5)
        p.setPen(Qt.PenStyle.NoPen)
        if self.cache:
            # 按深度分 8 桶 -> setBrush 从 192 次降到 16 次, 位置仍逐粒子计算
            buckets = [[] for _ in range(8)]
            for (ux, uy, uz) in SPHERE:
                x = ux * ca + uz * sa
                z = -ux * sa + uz * ca
                rad = 46.0 * (1.0 + 0.05 * math.sin(t * 3.0 + uy * 8.0))
                d = (z + 1.0) * 0.5
                buckets[min(7, int(d * 8))].append((CX + x * rad, CY + uy * rad))
            for b, items in enumerate(buckets):
                if not items:
                    continue
                d = (b + 0.5) / 8.0
                p.setBrush(self._brush("dot", bright, int(40 + 175 * d)))
                r = 1.0 + 1.4 * d
                for (px, py) in items:
                    p.drawEllipse(QPointF(px, py), r, r)
                p.setBrush(self._brush("halo", base, int(10 + 34 * d)))
                r2 = 2.6 + 4.0 * d
                for (px, py) in items:
                    p.drawEllipse(QPointF(px, py), r2, r2)
        else:
            for (ux, uy, uz) in SPHERE:
                x = ux * ca + uz * sa
                z = -ux * sa + uz * ca
                rad = 46.0 * (1.0 + 0.05 * math.sin(t * 3.0 + uy * 8.0))
                px, py = CX + x * rad, CY + uy * rad
                d = (z + 1.0) * 0.5                      # 0 背面 .. 1 正面
                dot = QColor(bright_c)
                dot.setAlpha(int(40 + 175 * d))
                p.setBrush(dot)
                p.drawEllipse(QPointF(px, py), 1.0 + 1.4 * d, 1.0 + 1.4 * d)
                halo = QColor(base_c)
                halo.setAlpha(int(10 + 34 * d))
                p.setBrush(halo)
                p.drawEllipse(QPointF(px, py), 2.6 + 4.0 * d, 2.6 + 4.0 * d)

        # ---- 4. 中心能量核 (加色堆叠 -> 白热核心)
        if self.cache:
            c_rad = (26.0 if motion != "pulse" else 24.0 + 6.0 * pqf) * 2.1
            p.drawPixmap(0, 0, WIN, WIN,
                         self._layer(f"core|{name}|{pq}",
                                     lambda r=c_rad: self._build_core(bright, r)))
        else:
            p.setBrush(self._glow("core", bright, core_r * 2.1, 150))
            p.drawEllipse(QPointF(CX, CY), core_r * 2.1, core_r * 2.1)
        hot = QColor(bright_c)
        hot.setAlpha(235)
        p.setBrush(hot)
        p.drawEllipse(QPointF(CX, CY), core_r, core_r)
        white = QColor(255, 255, 255, int(160 + 80 * pulse))
        p.setBrush(white)
        p.drawEllipse(QPointF(CX, CY), core_r * 0.42, core_r * 0.42)
        p.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceOver)
        p.restore()

        # ---- 5. 状态标签 (spike 便于肉眼/截图核对; 小尺寸自动缩字并截断, 不能溢出窗口)
        if self.show_label:
            f = QFont()
            f.setPointSize(max(6, int(round(9 * self.k))))
            p.setFont(f)
            p.setPen(QColor(255, 255, 255, 205))
            text = QtGui.QFontMetrics(f).elidedText(
                f"{cn} · {name}", Qt.TextElideMode.ElideRight, int(self.S - 8))
            p.drawText(QRectF(0, self.S - 24, self.S, 18),
                       int(Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignVCenter),
                       text)
        p.end()


def main() -> int:
    global LOG_HANDLE
    ap = argparse.ArgumentParser()
    ap.add_argument("--exit-after", type=float, default=0.0, help="秒; >0 自动退出")
    ap.add_argument("--cycle-seconds", type=float, default=3.0)
    ap.add_argument("--no-label", action="store_true")
    ap.add_argument("--reset", action="store_true", help="忽略已保存位置")
    ap.add_argument("--log", default="")
    ap.add_argument("--grab", default="", help="截图 PNG 路径(首帧后)")
    ap.add_argument("--grab-at", type=float, default=0.6, help="截图时刻(秒)")
    ap.add_argument("--simulate-drag", default="",
                    help="合成鼠标拖动事件 dx,dy, 真正走 mousePress/Move/Release 三个处理函数")
    ap.add_argument("--size", type=int, default=WIN,
                    help=f"图标窗口边长的逻辑像素 (设计稿基准 {WIN}; SPEC 默认 140)")
    ap.add_argument("--cache", action="store_true",
                    help="静态层缓存: 光晕/刻度环/核心光晕预渲染为 QPixmap, 粒子按深度分桶批量上色")
    ap.add_argument("--frame-ms", type=int, default=FRAME_MS,
                    help=f"帧定时器间隔毫秒 (默认 {FRAME_MS} ≈ 62fps; 33 ≈ 30fps)")
    ap.add_argument("--show", action="store_true",
                    help="显式要求真窗口。默认离屏! 真窗口仅限 DWM 合成/置顶/不抢焦点/点击穿透验证, "
                         "且会自动放到屏幕角落并强制 ≤20 秒")
    ap.add_argument("--restore-pos", action="store_true",
                    help="真窗口时沿用已保存位置(默认强制屏幕角落, 避免挡到用户)")
    ap.add_argument("--headless", action="store_true",
                    help="(兼容保留) 离屏渲染 — 现在这已是默认行为")
    args = ap.parse_args()

    # 默认离屏: 只有显式 --show 才创建真窗口
    args.headless = not args.show
    if not args.headless:
        if args.exit_after <= 0 or args.exit_after > 20:
            log(f"WARN 真窗口单次显示上限 20s: --exit-after {args.exit_after or 0} -> 20s")
            args.exit_after = 20.0
        if not args.restore_pos:
            log("WARN 真窗口将强制放到屏幕右下角 (加 --restore-pos 才用已保存位置)")

    # 离屏平台必须在 QApplication 之前设置
    if args.headless:
        os.environ["QT_QPA_PLATFORM"] = os.environ.get("DSH_SPIKE_QPA", "offscreen")

    here = Path(__file__).resolve().parent
    layout = here / "ark_layout.json"
    if args.reset and layout.exists():
        layout.unlink()
    if args.log:
        LOG_HANDLE = open(args.log, "w", encoding="utf-8")

    app = QApplication(sys.argv)
    app.setApplicationName("DSH Ark Core Spike")
    scr = app.primaryScreen()
    log(f"qt={QtCore.qVersion()} qpa={os.environ.get('QT_QPA_PLATFORM', '(default: windows)')} "
        f"screens={len(app.screens())} "
        f"primary={scr.geometry().width()}x{scr.geometry().height()} "
        f"available={scr.availableGeometry().width()}x{scr.availableGeometry().height()} "
        f"dpr={scr.devicePixelRatio()} logicalDpi={scr.logicalDotsPerInch()}")
    for i, s in enumerate(app.screens()):
        log(f"  screen[{i}] name={s.name()} geom={s.geometry().getRect()} "
            f"dpr={s.devicePixelRatio()}")

    core = ArkCore(layout, args.cycle_seconds, not args.no_label,
                   size=args.size, cache=args.cache, frame_ms=args.frame_ms,
                   headless=args.headless, corner=not args.restore_pos)
    if args.headless:
        log("headless=ON(默认): 不 show() 真窗口, 仅离屏渲染")
    else:
        log(f"headless=OFF: 真窗口模式, 将显示 {args.exit_after:.0f}s 后自动隐藏退出")
        core.show()

    if args.grab:
        def _grab() -> None:
            pm = core.grab()
            ok = pm.save(args.grab, "PNG")
            img = pm.toImage()
            log(f"grabbed {img.width()}x{img.height()} hasAlpha={img.hasAlphaChannel()} "
                f"saved={ok} path={args.grab}")
        QTimer.singleShot(int(args.grab_at * 1000), _grab)

    if args.simulate_drag and args.headless:
        log("simulate-drag skipped: 拖动验证必须有真窗口, headless 模式下不执行")
    elif args.simulate_drag:
        dx, dy = (int(v) for v in args.simulate_drag.split(","))

        def _drag() -> None:
            start = core.pos()
            gp = QPointF(core.x() + 120.0, core.y() + 120.0)
            lp = QPointF(120.0, 120.0)
            seq = [
                (QtCore.QEvent.Type.MouseButtonPress, Qt.MouseButton.LeftButton,
                 Qt.MouseButton.LeftButton),
                (QtCore.QEvent.Type.MouseMove, Qt.MouseButton.NoButton,
                 Qt.MouseButton.LeftButton),
                (QtCore.QEvent.Type.MouseMove, Qt.MouseButton.NoButton,
                 Qt.MouseButton.LeftButton),
                (QtCore.QEvent.Type.MouseButtonRelease, Qt.MouseButton.LeftButton,
                 Qt.MouseButton.NoButton),
            ]
            moves = [(0.0, 0.0), (dx * 0.4, dy * 0.4), (float(dx), float(dy)), (float(dx), float(dy))]
            for (etype, btn, btns), (mx, my) in zip(seq, moves):
                ev = QtGui.QMouseEvent(etype, QPointF(lp.x() + mx, lp.y() + my),
                                       QPointF(gp.x() + mx, gp.y() + my),
                                       btn, btns, Qt.KeyboardModifier.NoModifier)
                QApplication.sendEvent(core, ev)
            log(f"synthetic drag {dx},{dy}: {start.x()},{start.y()} -> {core.x()},{core.y()}")

        QTimer.singleShot(1200, _drag)

    if args.exit_after > 0:
        QTimer.singleShot(int(args.exit_after * 1000), app.quit)
        log(f"auto-exit in {args.exit_after}s")

    code = app.exec()
    avg_render = (core.render_ms / core.renders) if core.renders else 0.0
    log(f"event loop exited code={code} total_frames={core.frames} "
        f"state_switches={core.state_changes} final_pos=({core.x()},{core.y()}) "
        f"offscreen_renders={core.renders} avg_render_ms={avg_render:.2f}")
    if LOG_HANDLE is not None:
        LOG_HANDLE.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
