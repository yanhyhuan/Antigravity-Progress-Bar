param([switch]$PanelOnly)
$ErrorActionPreference = 'Stop'
$pulsePython = Get-Command python -ErrorAction SilentlyContinue
if (-not $pulsePython) { throw 'Python 3.10+ is required. Install Python, then run this script again.' }

$localManage = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'manage.py' } else { $null }
if ($localManage -and (Test-Path $localManage)) {
    $pulseArguments = @($localManage, 'install')
    if ($PanelOnly) { $pulseArguments += '--panel-only' }
    & $pulsePython.Source @pulseArguments
    if ($LASTEXITCODE -ne 0) { throw 'Antigravity Progress Bar installation failed. See the error above.' }
    return
}

$repo = 'yanhyhuan/Antigravity-Progress-Bar'
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'Antigravity-Progress-Bar-Installer' }
$zipAsset = $release.assets | Where-Object { $_.name -match '^antigrative-dashboard-.*\.zip$' } | Select-Object -First 1
$shaAsset = $release.assets | Where-Object { $_.name -eq "$($zipAsset.name).sha256" } | Select-Object -First 1
if (-not $zipAsset -or -not $shaAsset) { throw "Release assets not found in $repo." }

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ag-progress-bar-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
try {
    $zipPath = Join-Path $tempDir $zipAsset.name
    $shaPath = Join-Path $tempDir $shaAsset.name
    Invoke-WebRequest -Uri $zipAsset.browser_download_url -OutFile $zipPath
    Invoke-WebRequest -Uri $shaAsset.browser_download_url -OutFile $shaPath
    $expectedSha = ((Get-Content $shaPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $actualSha = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expectedSha -ne $actualSha) { throw "SHA-256 checksum mismatch for $($zipAsset.name)." }

    $installRoot = Join-Path $HOME '.gemini\antigravity-progress-bar'
    $extractDir = Join-Path $tempDir 'extracted'
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    $inner = Join-Path $extractDir 'antigrative-dashboard'
    if (Test-Path $installRoot) { Remove-Item $installRoot -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path $installRoot -Parent) | Out-Null
    Move-Item -Path $inner -Destination $installRoot

    $pulseArguments = @((Join-Path $installRoot 'manage.py'), 'install')
    if ($PanelOnly) { $pulseArguments += '--panel-only' }
    & $pulsePython.Source @pulseArguments
    if ($LASTEXITCODE -ne 0) { throw 'Antigravity Progress Bar installation failed. See the error above.' }
} finally {
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
