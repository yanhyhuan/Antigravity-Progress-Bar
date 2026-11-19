# Detached worker: display Windows Toast notification, play sound alert, and run optional audio/TTS announcement.
param([string]$JobFile)
$ErrorActionPreference = 'SilentlyContinue'
if ($env:OS -ne 'Windows_NT') { exit 0 }

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

try { $job = Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { exit 0 }
Remove-Item -LiteralPath $JobFile -Force

$title = if ($job.isError) { $cfg['titleError'] } else { $cfg['titleDone'] }
if (-not $title) { $title = if ($job.isError) { 'Antigravity: error' } else { 'Antigravity: done' } }
$uElapsed = "$([char]0x7528)$([char]0x65F6)"
$uReason  = "$([char]0x539F)$([char]0x56E0)$([char]0xFF1A)"
$line1 = if ($job.dur) { "$uElapsed $($job.dur)" } else { '' }
if ($job.isError -and $job.reason) { $line1 = ($line1 + "  $uReason$($job.reason)").Trim() }
$line2 = [string]$job.ask

function Esc([string]$s) { [System.Security.SecurityElement]::Escape($s) }

$shown = $false
try {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $audio = if ($cfg['sound'] -eq $false) { '<audio silent="true"/>' }
           elseif ($job.isError) { '<audio src="ms-winsoundevent:Notification.Looping.Alarm2" loop="false"/>' }
           else { '<audio src="ms-winsoundevent:Notification.Default"/>' }
  $xml = @"
<toast>
  <visual><binding template="ToastGeneric">
    <text>$(Esc $title)</text>
    <text>$(Esc $line1)</text>
    <text>$(Esc $line2)</text>
  </binding></visual>
  $audio
</toast>
"@
  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
  $doc.LoadXml($xml)
  $toast = New-Object Windows.UI.Notifications.ToastNotification $doc
  $aumid = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid).Show($toast)
  $shown = $true
} catch {}

# Fallback beep when Windows notification center suppresses toast popups.
if (-not $shown -and $cfg['sound'] -ne $false) {
  [System.Media.SystemSounds]::Asterisk.Play()
  Start-Sleep -Milliseconds 800
}

if ($cfg['speak'] -eq $true) {
  if ($shown -and $cfg['sound'] -ne $false) {
    Start-Sleep -Milliseconds 450
  }

  $spoken = $false
  $relAudio = if ($job.isError) { [string]$cfg['audioError'] } else { [string]$cfg['audioDone'] }
  if ($relAudio) {
    $audioPath = if ([System.IO.Path]::IsPathRooted($relAudio)) { $relAudio } else { Join-Path $root $relAudio }
    if (Test-Path -LiteralPath $audioPath -PathType Container) {
      $pick = Get-ChildItem -LiteralPath $audioPath -File | Where-Object { $_.Extension -match '^\.(mp3|wav|m4a|wma)$' } | Get-Random -Count 1
      $audioPath = if ($pick) { $pick.FullName } else { '' }
    }
    if ($audioPath -and (Test-Path -LiteralPath $audioPath -PathType Leaf)) {
      try {
        Add-Type -AssemblyName PresentationCore
        $player = New-Object System.Windows.Media.MediaPlayer
        $vol = if ($null -ne $cfg['speakVolume']) { [Math]::Max(0.0, [Math]::Min(1.0, [double]$cfg['speakVolume'])) } else { 1.0 }
        $player.Volume = $vol
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $player.Open([Uri]::new((Resolve-Path -LiteralPath $audioPath).Path))
        $player.Play()
        for ($i = 0; $i -lt 30; $i++) {
          if ($player.NaturalDuration.HasTimeSpan) { break }
          Start-Sleep -Milliseconds 100
        }
        $totalMs = if ($player.NaturalDuration.HasTimeSpan) { [int]$player.NaturalDuration.TimeSpan.TotalMilliseconds } else { 4000 }
        $remainMs = [Math]::Max(0, $totalMs - [int]$sw.ElapsedMilliseconds) + 250
        Start-Sleep -Milliseconds $remainMs
        $player.Close()
        $spoken = $true
      } catch {}
    }
  }

  if (-not $spoken) {
    try {
      Add-Type -AssemblyName System.Speech
      $tts = New-Object System.Speech.Synthesis.SpeechSynthesizer
      $zh = $tts.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1
      if ($zh) { $tts.SelectVoice($zh.VoiceInfo.Name) }
      $say = if ($job.isError) { $cfg['speakError'] } else { $cfg['speakDone'] }
      if ($say) { $tts.Speak($say) }
    } catch {}
  }
}
