<#
.SYNOPSIS
  Launch Chrome or Firefox with the Page Debug Snapshot extension loaded on a separate dev profile,
  or pack the extension into a dev zip for a tester.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/dev-browser.ps1 -Browser chrome
  powershell -ExecutionPolicy Bypass -File scripts/dev-browser.ps1 -Browser firefox -Url https://www.example.com
  powershell -ExecutionPolicy Bypass -File scripts/dev-browser.ps1 -Pack -Browser firefox
#>
[CmdletBinding()]
param(
  [ValidateSet("chrome", "firefox")]
  [string]$Browser = "chrome",
  [string]$Url = "https://www.example.com",
  [switch]$Pack
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

# dist/<target> (after E0 build) wins over the source directory
$extDir = Join-Path $repoRoot "dist\$Browser"
if (-not (Test-Path (Join-Path $extDir "manifest.json"))) {
  $extDir = Join-Path $repoRoot "page-debug-extension"
}
if (-not (Test-Path (Join-Path $extDir "manifest.json"))) {
  throw "No manifest.json found in dist/$Browser or page-debug-extension/"
}
Write-Host "Target: $Browser  |  Extension directory: $extDir"

if ($Pack) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmm"
  $zip = Join-Path $repoRoot "page-debug-snapshot-dev-$Browser-$stamp.zip"
  $staging = Join-Path $env:TEMP "pds-pack-$stamp"
  New-Item -ItemType Directory -Path $staging | Out-Null

  # copy everything except dev-only and oversized files
  Get-ChildItem -Path $extDir -Recurse -File | Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.Extension -notin @('.zip', '.pem', '.crx') -and
    $_.Name -notlike 'logo*.png' -and
    $_.Name -notlike 'package*.json'
  } | ForEach-Object {
    $rel = $_.FullName.Substring($extDir.Length).TrimStart('\')
    $dest = Join-Path $staging $rel
    New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
    Copy-Item $_.FullName $dest
  }

  Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip -Force
  Remove-Item $staging -Recurse -Force
  $sizeKb = [math]::Round((Get-Item $zip).Length / 1KB)
  Write-Host "Packed: $zip ($sizeKb KB)"
  if ($Browser -eq "firefox") {
    Write-Host "Recipient: do NOT unzip -> about:debugging#/runtime/this-firefox -> Load Temporary Add-on -> pick the zip (gone after restart)"
  } else {
    Write-Host "Recipient: unzip -> chrome://extensions -> Developer mode -> Load unpacked -> pick the folder"
  }
  exit 0
}

if ($Browser -eq "firefox") {
  # Prefer web-ext: fresh profile, extension preloaded, auto-reload on file change
  $webExt = Get-Command "web-ext" -ErrorAction SilentlyContinue
  $hasNpx = Get-Command "npx" -ErrorAction SilentlyContinue
  if ($webExt -or $hasNpx) {
    Write-Host "Launching Firefox via web-ext (auto-reload on change). Ctrl+C to stop."
    if ($webExt) {
      & web-ext run --source-dir $extDir --start-url $Url
    } else {
      & npx --yes web-ext run --source-dir $extDir --start-url $Url
    }
    exit $LASTEXITCODE
  }

  $firefox = @(
    "$env:ProgramFiles\Mozilla Firefox\firefox.exe",
    "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe",
    "$env:LOCALAPPDATA\Mozilla Firefox\firefox.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $firefox) { throw "firefox.exe not found and web-ext unavailable" }

  $profile = Join-Path $env:LOCALAPPDATA "pds-dev-profile-firefox"
  New-Item -ItemType Directory -Path $profile -Force | Out-Null
  Write-Host "Launching Firefox (profile: $profile)."
  Write-Host "Then: about:debugging -> This Firefox -> Load Temporary Add-on -> $extDir\manifest.json"
  Start-Process -FilePath $firefox -ArgumentList @(
    "-profile", $profile, "-no-remote",
    "about:debugging#/runtime/this-firefox", $Url
  )
  exit 0
}

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw "chrome.exe not found" }

$profile = Join-Path $env:LOCALAPPDATA "pds-dev-profile-chrome"
New-Item -ItemType Directory -Path $profile -Force | Out-Null

$chromeArgs = @(
  "--user-data-dir=$profile",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions-except=$extDir",
  "--load-extension=$extDir",
  "chrome://extensions",
  $Url
)
Write-Host "Launching Chrome (profile: $profile)"
Start-Process -FilePath $chrome -ArgumentList $chromeArgs
