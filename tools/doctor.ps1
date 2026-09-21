# doctor.ps1 -- one-shot status dump for dsh-work-icon troubleshooting.
# Purpose: replace 5-10 separate ad-hoc probes with ONE command.
# NOTE: this file is intentionally ASCII-only (PS1 helpers must stay ASCII: non-ASCII gets
#       mangled when written/read through PowerShell and has broken scripts on this machine).
$ErrorActionPreference = 'SilentlyContinue'
$PLUG = 'C:\Users\david\.dsh\local-plugins\dsh-work-icon'
$HOME_ICON = Join-Path $env:USERPROFILE '.dsh\work-icon'

# The helper.log evidence pattern is 'setting <U+6291><U+5236>'. The two CJK code points are
# built from escapes on purpose: THIS FILE MUST STAY ASCII-ONLY (see the note above), and a
# literal CJK string here would be mangled when PowerShell reads the script on this machine.
$CJK_SUPPRESS = -join [char[]](0x6291, 0x5236)
$evPat = 'includeSubagents|setting -> host|setting ' + $CJK_SUPPRESS

function H($t) { "`n=== $t ===" }

H 'TIME'
"now  : " + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
$os = Get-CimInstance Win32_OperatingSystem
if ($os) { "boot : " + $os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm:ss') + "  (up " + [int]((Get-Date) - $os.LastBootUpTime).TotalMinutes + " min)" }

H 'PORTS (3080 = dsh web, 8899 = preview server)'
foreach ($p in 3080, 8899) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p | Select-Object -First 1
  if ($c) { "port $p : pid $($c.OwningProcess)" } else { "port $p : (none listening)" }
}

H 'ICON PROCESSES (electron with work-icon in cmdline)'
$e = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*work-icon*' }
if ($e) { $e | ForEach-Object { "pid " + $_.ProcessId + "  started " + $_.CreationDate.ToString('HH:mm:ss') } } else { "(none - icon not running)" }

H 'LIVE CONFIG (the file both sides read)'
$cfg = Join-Path $HOME_ICON 'config.json'
if (Test-Path $cfg) {
  $j = Get-Content $cfg -Raw -Encoding UTF8 | ConvertFrom-Json
  "file             : $cfg"
  "mtime            : " + (Get-Item $cfg).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
  "includeSubagents : $($j.includeSubagents)"
  "windowTimeoutMs  : $($j.windowTimeoutMs)"
  "pulseIntervalMs  : $($j.pulseIntervalMs)"
  "window.fps       : $($j.window.fps)"
} else { "missing: $cfg" }

H 'LOG TAILS'
$h = Join-Path $HOME_ICON 'helper.log'
if (Test-Path $h) {
  "helper.log  mtime " + (Get-Item $h).LastWriteTime.ToString('HH:mm:ss')
  $tail = Get-Content $h -Tail 4 -Encoding UTF8
  $tail | ForEach-Object { "  " + $_ }
  # widen to the WHOLE file: a -Tail 400 window only covers ~1 minute of this dense log,
  # and asking "did X ever happen" with a truncated window is how you get a false negative.
  $whole = Get-Content $h -Encoding UTF8
  "  silence lines (whole log): " + (($whole | Select-String -Pattern 'silence:').Count)
  "  nodata lines  (whole log): " + (($whole | Select-String -Pattern 'plate nodata').Count)
  "  toggle/setting evidence (whole log, last 6 of " + (($whole | Select-String -Pattern $evPat).Count) + "):"
  $ev = $whole | Select-String -Pattern $evPat
  if ($ev) { $ev | Select-Object -Last 6 | ForEach-Object { "    " + $_.Line } } else { "    (none)" }
} else { "helper.log missing" }
$hd = Join-Path $HOME_ICON 'host.log'
if (Test-Path $hd) {
  "host.log    mtime " + (Get-Item $hd).LastWriteTime.ToString('HH:mm:ss')
  Get-Content $hd -Tail 3 -Encoding UTF8 | ForEach-Object { "  " + $_ }
} else { "host.log    (not created yet)" }

H 'SOURCE EDITS IN LAST 6H (who is writing what)'
# NOTE: do NOT recurse the whole plugin dir. It contains node_modules + test\out (hundreds of
#       run homes) => a full -Recurse took 28s on this machine. Only these 4 dirs matter.
$cut = (Get-Date).AddHours(-6)
$files = @()
foreach ($d in @('src', 'test', 'runtime\electron', 'runtime\electron\tests')) {
  $p = Join-Path $PLUG $d
  if (Test-Path $p) { $files += Get-ChildItem -Path (Join-Path $p '*') -File -Include '*.js', '*.mjs', '*.html' }
}
$files | Where-Object { $_.LastWriteTime -gt $cut } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 8 |
  ForEach-Object { $_.LastWriteTime.ToString('HH:mm:ss') + "  " + $_.FullName.Replace($PLUG + '\', '') }

H 'DONE'
