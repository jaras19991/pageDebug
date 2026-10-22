<#
.SYNOPSIS
  Build the extension and launch Chrome or Firefox with it on a temporary profile (via scripts/dev-browser.mjs),
  or run npm run pack and print the dist zip for <browser> with tester instructions.

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

# -Pack: npm run pack builds every target and writes dist\page-debug-snapshot-<target>-<version>.zip
# (sorted entries, "/" separators); otherwise just build before handing over to dev-browser.mjs.
Push-Location $repoRoot
try {
  if ($Pack) { & npm run pack } else { & npm run build }
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

$extDir = Join-Path $repoRoot "dist\$Browser"
$manifestPath = Join-Path $extDir "manifest.json"
if (-not (Test-Path $manifestPath)) {
  throw "No manifest.json found in dist\$Browser after build"
}

if ($Pack) {
  $version = (Get-Content $manifestPath -Raw | ConvertFrom-Json).version
  $zip = Join-Path $repoRoot "dist\page-debug-snapshot-$Browser-$version.zip"
  if (-not (Test-Path $zip)) { throw "Zip not found after npm run pack: $zip" }
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
