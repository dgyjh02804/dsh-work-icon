# proc-cpu.ps1 —— 采样「以 RootPid 为根的整棵进程树」的 CPU 与内存
# CPU 口径与 spike\Measure-ProcCpu.ps1 一致：TotalProcessorTime 增量 → 单核百分比 / 整机百分比
# 用法: powershell -File proc-cpu.ps1 -RootPid 1234 -Seconds 5 -Warmup 2 -Label idle
param(
  [Parameter(Mandatory=$true)][int]$RootPid,
  [int]$Seconds = 5,
  [int]$Warmup = 0,
  [string]$Label = ''
)
$ErrorActionPreference = 'SilentlyContinue'

function Get-Tree([int]$root) {
  $all = Get-CimInstance Win32_Process
  $ids = New-Object 'System.Collections.Generic.List[int]'
  [void]$ids.Add($root)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($p in $all) {
      $pp = [int]$p.ParentProcessId; $cp = [int]$p.ProcessId
      if ($ids.Contains($pp) -and -not $ids.Contains($cp)) { [void]$ids.Add($cp); $changed = $true }
    }
  }
  return $ids
}
function Snapshot([int]$root) {
  $ids = Get-Tree $root
  $cpu = 0.0; $ws = 0.0; $priv = 0.0; $n = 0
  foreach ($id in $ids) {
    $p = Get-Process -Id $id
    if ($null -eq $p) { continue }
    $cpu += $p.TotalProcessorTime.TotalSeconds
    $ws += $p.WorkingSet64 / 1MB
    $priv += $p.PrivateMemorySize64 / 1MB
    $n++
  }
  return [pscustomobject]@{ Cpu = $cpu; WS = $ws; Priv = $priv; Count = $n }
}

if ($Warmup -gt 0) { Start-Sleep -Seconds $Warmup }
$a = Snapshot $RootPid
Start-Sleep -Seconds $Seconds
$b = Snapshot $RootPid
$cores = [Environment]::ProcessorCount
$dcpu = $b.Cpu - $a.Cpu
$pctCore = ($dcpu / $Seconds) * 100
$pctMachine = $pctCore / $cores
Write-Output ("RESULT label={0} procs={1} cpu_delta={2:N2}s over {3}s -> {4:N2}% of ONE core, {5:N3}% of machine (cores={6}) working_set_sum={7:N1}MB private_sum={8:N1}MB" -f `
  $Label, $b.Count, $dcpu, $Seconds, $pctCore, $pctMachine, $cores, $b.WS, $b.Priv)
