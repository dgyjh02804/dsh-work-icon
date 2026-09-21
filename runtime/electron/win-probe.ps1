# win-probe.ps1 —— 返回指定屏幕点上「最顶层可命中窗口」的信息
# 与系统鼠标命中测试同口径：带 WS_EX_TRANSPARENT 的窗口（= Electron setIgnoreMouseEvents(true) 所设）
# 会被 WindowFromPoint 跳过，返回它下面的窗口。这是"点击穿透"的客观取证方式。
# 用法: powershell -File win-probe.ps1 -X 1900 -Y 900
# 输出: HWND=0x... ROOT=0x... CLASS=... PROC=... TITLE=...
param([Parameter(Mandatory=$true)][int]$X, [Parameter(Mandatory=$true)][int]$Y)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinProbe {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string Probe(int x, int y) {
    POINT p; p.x = x; p.y = y;
    IntPtr h = WindowFromPoint(p);
    IntPtr root = GetAncestor(h, 2);
    StringBuilder cs = new StringBuilder(256); GetClassName(h, cs, 256);
    StringBuilder ts = new StringBuilder(256); GetWindowText(root, ts, 256);
    uint pid = 0; GetWindowThreadProcessId(h, out pid);
    return "HWND=0x" + ((long)h).ToString("x") + " ROOT=0x" + ((long)root).ToString("x") +
           " PID=" + pid + " CLASS=" + cs.ToString() + " TITLE=" + ts.ToString();
  }
}
'@
[WinProbe]::Probe($X, $Y)
