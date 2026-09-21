真实输入合成脚本 —— 已按 SPEC 第 10 节第 1 条**永久删除**（不是隔离）：

  已删除：mouse-drag.ps1 / mouse-click.ps1 / probe-dpi.ps1 / cursor-probe.js
  原因：这些脚本用 SetCursorPos + mouse_event 抢占用户真实键鼠（2026-09-12 事故）。
  禁止恢复、禁止重写、禁止换个名字重来。

替代做法（已在用，均不触碰光标）：
  - 拖动验证：产品内部路径 --test-drag（触发 drag-by / drag-end，与真实拖动同一条代码路径）
  - 点击穿透取证：WindowFromPoint 命中测试 + WS_EX_TRANSPARENT exstyle（只读查询）
  - 真实鼠标端到端：由人在场时手工做，不由脚本做
  - 真窗口会话：单次 <= 20 秒、放屏幕右下角、测完立即 hide+destroy 并清理 electron.exe
