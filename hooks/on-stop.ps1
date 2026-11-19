# Stop hook: check notification conditions and launch detached Windows toast/audio worker without blocking the agent.
$ErrorActionPreference = 'SilentlyContinue'
if ($env:OS -ne 'Windows_NT') { [Console]::Out.Write('{}'); exit 0 }
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Done { [Console]::Out.Write('{}'); exit 0 }

$root = Split-Path -Parent $PSScriptRoot
$cfg = @{
  enabled       = $true
  minSeconds    = 30
  notifyOnError = $true
  sound         = $true
  speak         = $true
  speakVolume   = 1.0
  titleDone     = "Antigravity$([char]0xFF1A)$([char]0x4EFB)$([char]0x52A1)$([char]0x5B8C)$([char]0x6210)"
  titleError    = "Antigravity$([char]0xFF1A)$([char]0x4EFB)$([char]0x52A1)$([char]0x51FA)$([char]0x9519)$([char]0x505C)$([char]0x4E0B)$([char]0x4E86)"
  speakDone     = "$([char]0x4EFB)$([char]0x52A1)$([char]0x5B8C)$([char]0x6210)$([char]0x5566)$([char]0xFF0C)$([char]0x56DE)$([char]0x6765)$([char]0x770B)$([char]0x770B)$([char]0x5427)"
  speakError    = "$([char]0x4EFB)$([char]0x52A1)$([char]0x51FA)$([char]0x9519)$([char]0x4E86)$([char]0xFF0C)$([char]0x5FEB)$([char]0x6765)$([char]0x770B)$([char]0x770B)"
  audioDone     = 'sounds/done.mp3'
  audioError    = 'sounds/error.mp3'
}
foreach ($cfgPath in @(
  (Join-Path $PSScriptRoot 'default-settings.json'),
  (Join-Path $root 'settings.json'),
  (Join-Path $root 'notify-settings.json')
)) {
  if (Test-Path -LiteralPath $cfgPath -PathType Leaf) {
    try {
      $loaded = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($loaded) {
        foreach ($prop in $loaded.PSObject.Properties) {
          $cfg[$prop.Name] = $prop.Value
        }
      }
    } catch {}
  }
}
if ($cfg['enabled'] -eq $false) { Done }

try { $p = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { Done }
if (-not $p) { Done }

# 1. Only notify when truly idle (skip when background tasks/subagents are still running).
if ($p.fullyIdle -eq $false) { Done }
$reason = [string]$p.terminationReason
$isError = $false
switch ($reason) {
  'USER_CANCELED'             { Done }
  'ERROR'                     { $isError = $true }
  'MAX_TOKEN_BUDGET_EXCEEDED' { $isError = $true }
  'MAX_INVOCATIONS'           { $isError = $true }
}
if ($isError -and $cfg['notifyOnError'] -eq $false) { Done }

# 2. Measure turn duration from the last USER_INPUT step in transcript.jsonl.
$elapsed = $null
$paths = @()
if ($p.transcriptPath) { $paths += [string]$p.transcriptPath }
if ($p.conversationId) {
  foreach ($app in 'antigravity','antigravity-ide','antigravity-cli') {
    $paths += Join-Path $env:USERPROFILE ".gemini\$app\brain\$($p.conversationId)\.system_generated\logs\transcript.jsonl"
  }
}
foreach ($t in $paths) {
  if (-not (Test-Path -LiteralPath $t)) { continue }
  $lines = Get-Content -LiteralPath $t -Encoding UTF8 -Tail 400
  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    if ($lines[$i] -notmatch '"USER_INPUT"') { continue }
    try {
      $o = $lines[$i] | ConvertFrom-Json
      if ($o.type -eq 'USER_INPUT' -and $o.created_at) {
        $start = [DateTimeOffset]::Parse([string]$o.created_at)
        $elapsed = ([DateTimeOffset]::UtcNow - $start).TotalSeconds
        break
      }
    } catch {}
  }
  if ($null -ne $elapsed) { break }
}
if (-not $isError -and $null -ne $elapsed -and $elapsed -lt [double]$cfg['minSeconds']) { Done }

# 3. Short deduplication guard so duplicate hooks never double-fire on the same stop event.
$dedupId = if ($p.conversationId) { ($p.conversationId -replace '[^a-zA-Z0-9_-]', '') } else { 'default' }
$dedupFile = Join-Path $env:TEMP "agy-notify-dedup-$dedupId.lock"
$nowUnix = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
if (Test-Path -LiteralPath $dedupFile -PathType Leaf) {
  try {
    $lastUnix = [long](Get-Content -LiteralPath $dedupFile -Raw -Encoding UTF8).Trim()
    if (($nowUnix - $lastUnix) -ge 0 -and ($nowUnix - $lastUnix) -lt 4000) { Done }
  } catch {}
}
try { Set-Content -LiteralPath $dedupFile -Value $nowUnix -Encoding UTF8 -NoNewline } catch {}

# 4. Write job payload to temp file and spawn detached notification worker.
$uHour = "$([char]0x5C0F)$([char]0x65F6)"
$uMin  = "$([char]0x5206)"
$uSec  = "$([char]0x79D2)"
$ask = [string]$p.lastUserInput
$ask = ($ask -replace '\s+', ' ').Trim()
if ($ask.Length -gt 60) { $ask = $ask.Substring(0, 60) + [char]0x2026 }
$dur = ''
if ($null -ne $elapsed) {
  $ts = [TimeSpan]::FromSeconds([Math]::Round($elapsed))
  if ($ts.TotalHours -ge 1) { $dur = '{0}{1}{2}{3}' -f [int]$ts.TotalHours, $uHour, $ts.Minutes, $uMin }
  elseif ($ts.TotalMinutes -ge 1) { $dur = '{0}{1}{2}{3}' -f [int]$ts.TotalMinutes, $uMin, $ts.Seconds, $uSec }
  else { $dur = '{0}{1}' -f $ts.Seconds, $uSec }
}
$job = [pscustomobject]@{
  isError = $isError
  reason  = $reason
  ask     = $ask
  dur     = $dur
}
$tmp = Join-Path $env:TEMP ("agy-notify-" + [guid]::NewGuid().ToString('N') + '.json')
$job | ConvertTo-Json -Compress | Set-Content -LiteralPath $tmp -Encoding UTF8

Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
  '-File', (Join-Path $PSScriptRoot 'toast.ps1'), '-JobFile', $tmp
)
Done
