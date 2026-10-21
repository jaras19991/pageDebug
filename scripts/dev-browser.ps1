<#
.SYNOPSIS
  Build the extension and launch Chrome or Firefox with it on a temporary profile (via scripts/dev-browser.mjs),
  or pack dist\<browser> into a dev zip for a tester.

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

Push-Location $repoRoot
try {
  & npm run build
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

$extDir = Join-Path $repoRoot "dist\$Browser"
if (-not (Test-Path (Join-Path $extDir "manifest.json"))) {
  throw "No manifest.json found in dist\$Browser after build"
}

if ($Pack) {
  Write-Host "Target: $Browser  |  Extension directory: $extDir"
  $stamp = Get-Date -Format "yyyyMMdd-HHmm"
  $zip = Join-Path $repoRoot "page-debug-snapshot-dev-$Browser-$stamp.zip"
  $staging = Join-Path $env:TEMP "pds-pack-$stamp"
  New-Item -ItemType Directory -Path $staging | Out-Null

  # copy everything except dev-only and oversized files
  Get-ChildItem -Path $extDir -Recurse -File | Where-Object {
    $_.FullName -notmatch '\node_modules\' -and
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

# web-ext: temporary profile, extension loaded over CDP / RDP, auto-reload on change. Ctrl+C to stop.
& node (Join-Path $repoRoot "scripts\dev-browser.mjs") $Browser --url $Url
exit $LASTEXITCODE
