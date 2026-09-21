# focus-dsh.ps1 -- raise the first window whose title matches -Pattern (SPEC section 6: silent no-op when absent).
# Usage: powershell -File focus-dsh.ps1 -Pattern DSH
# Exit codes: 0 = found and raised (or raise attempted); 3 = not found; 4 = Windows refused the foreground switch.
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 decodes a BOM-less .ps1 as ANSI, and a mangled
#       UTF-8 comment can swallow the next line -- that silently killed the param() block here once,
#       leaving $Pattern $null (which matches EVERY titled window).
param([string]$Pattern = 'DSH|DeepSeek Harness')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static bool Raise(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);      // SW_RESTORE
    else ShowWindow(h, 5);                  // SW_SHOW
    return SetForegroundWindow(h);
  }
}
'@
if ([string]::IsNullOrWhiteSpace($Pattern)) { Write-Output 'empty-pattern'; exit 3 }
$hit = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and ($_.MainWindowTitle -match $Pattern)
} | Select-Object -First 1
if (-not $hit) { Write-Output 'not-found'; exit 3 }
$ok = [Fg]::Raise($hit.MainWindowHandle)
Write-Output ("found pid={0} title={1} raised={2}" -f $hit.Id, $hit.MainWindowTitle, $ok)
if (-not $ok) { exit 4 }
exit 0
