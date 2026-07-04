$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$bundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$node = Get-Command node -ErrorAction SilentlyContinue
$python = Get-Command python -ErrorAction SilentlyContinue

if (Test-Path $bundledNode) {
  $nodeExe = $bundledNode
} elseif ($node) {
  $nodeExe = $node.Source
}

if (Test-Path $bundledPython) {
  $pythonExe = $bundledPython
} elseif ($python) {
  $pythonExe = $python.Source
}

Set-Location -LiteralPath $projectRoot
Write-Host "Serving NewBorn Helper at http://127.0.0.1:5173"
if ($nodeExe) {
  & $nodeExe .\serve.mjs
} elseif ($pythonExe) {
  & $pythonExe -m http.server 5173 --bind 127.0.0.1
} else {
  throw "Node.js or Python was not found. Install one of them or run this from Codex with bundled workspace dependencies."
}
