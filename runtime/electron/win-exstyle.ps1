# win-exstyle.ps1 —— 读取某个窗口的 GWL_EXSTYLE（透明穿透的客观证据：WS_EX_TRANSPARENT=0x20）
# 用法: powershell -File win-exstyle.ps1 -Hwnd 0x1234
# 输出: EXSTYLE=0x00080088 TRANSPARENT=yes|no NOACTIVATE=yes|no TOOLWINDOW=yes|no TOPMOST=yes|no
param([Parameter(Mandatory=$true)][string]$Hwnd)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ExStyle {
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll", SetLastError=true)] public static extern long GetWindowLongPtr(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  public static string Read(string hex) {
    long v = Convert.ToInt64(hex.Replace("0x", ""), 16);
    IntPtr h = new IntPtr(v);
    long ex;
    try { ex = GetWindowLongPtr(h, -20); } catch { ex = GetWindowLong(h, -20); }
    if (ex == 0) ex = GetWindowLong(h, -20);
    return "EXSTYLE=0x" + ex.ToString("x8")
      + " TRANSPARENT=" + (((ex & 0x20) != 0) ? "yes" : "no")
      + " NOACTIVATE=" + (((ex & 0x08000000) != 0) ? "yes" : "no")
      + " TOOLWINDOW=" + (((ex & 0x80) != 0) ? "yes" : "no")
      + " TOPMOST=" + (((ex & 0x8) != 0) ? "yes" : "no")
      + " LAYERED=" + (((ex & 0x80000) != 0) ? "yes" : "no");
  }
}
'@
[ExStyle]::Read($Hwnd)
