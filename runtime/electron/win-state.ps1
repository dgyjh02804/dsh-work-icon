# win-state.ps1 -- READ-ONLY query: extended style bits of a target window + whether it is the foreground window.
# Uses only GetWindowLongPtr / GetForegroundWindow / IsWindowVisible (read-only Win32 queries).
# It never moves the cursor and never synthesizes input (SPEC section 10 red line).
# NOTE: keep this file pure ASCII -- Windows PowerShell 5.1 decodes a BOM-less .ps1 as ANSI,
#       and a mangled UTF-8 comment can swallow the following line (that bug silently killed param()).
param([Parameter(Mandatory=$true)][string]$Hwnd)
if ($Hwnd -match '^0x') { $Hwnd = [Convert]::ToInt64($Hwnd.Substring(2), 16) }
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinState {
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public static string Run(long hwnd) {
    IntPtr h = new IntPtr(hwnd);
    long ex = GetWindowLongPtr(h, -20).ToInt64();
    IntPtr fg = GetForegroundWindow();
    StringBuilder sb = new StringBuilder(256);
    GetWindowTextW(fg, sb, 256);
    return "EXSTYLE=0x" + ex.ToString("X8")
      + " TOPMOST=" + (((ex & 0x00000008) != 0) ? "yes" : "no")
      + " TRANSPARENT=" + (((ex & 0x00000020) != 0) ? "yes" : "no")
      + " NOACTIVATE=" + (((ex & 0x08000000) != 0) ? "yes" : "no")
      + " TOOLWINDOW=" + (((ex & 0x00000080) != 0) ? "yes" : "no")
      + " LAYERED=" + (((ex & 0x00080000) != 0) ? "yes" : "no")
      + " VISIBLE=" + (IsWindowVisible(h) ? "yes" : "no")
      + " IS_FOREGROUND=" + ((fg == h) ? "yes" : "no")
      + " FOREGROUND_HWND=0x" + fg.ToInt64().ToString("X") + " FOREGROUND_TITLE=" + sb.ToString();
  }
}
'@
[WinState]::Run([int64]$Hwnd)
