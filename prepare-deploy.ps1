$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$publicRoot = Join-Path $projectRoot "public"
$assetTarget = Join-Path $publicRoot "assets"

if (-not (Test-Path $publicRoot)) {
  New-Item -ItemType Directory -Path $publicRoot | Out-Null
}

if (-not (Test-Path $assetTarget)) {
  New-Item -ItemType Directory -Path $assetTarget | Out-Null
}

$files = @(
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "manifest.webmanifest",
  "sw.js",
  "reset-cache.html"
)

foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $publicRoot $file) -Force
}

Copy-Item -LiteralPath (Join-Path $projectRoot "assets\icon.svg") -Destination (Join-Path $assetTarget "icon.svg") -Force

Write-Host "Prepared deploy folder: $publicRoot"
