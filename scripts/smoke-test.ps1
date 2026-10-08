# Smoke test del puente de navegador (sin navegador real).
# Verifica: shim `browser`, runtime en modo offline (sin token de Codex),
# servicio parcheado y el puente extension-host <-> node_repl.
$ErrorActionPreference = 'Stop'

$InstallDir = (Resolve-Path "$PSScriptRoot\..").Path
$nodeExe = Join-Path $InstallDir "runtime\bin\node.exe"
$script = Join-Path $PSScriptRoot "smoke-browser-bridge.mjs"

Write-Host ""
Write-Host "=== ComputerUser - Smoke test del puente de navegador ===" -ForegroundColor Cyan
Write-Host "Instalacion: $InstallDir" -ForegroundColor Gray
Write-Host ""

if (-not (Test-Path $nodeExe)) { throw "Falta runtime\bin\node.exe en $InstallDir" }
if (-not (Test-Path $script)) { throw "Falta scripts\smoke-browser-bridge.mjs" }

& $nodeExe $script $InstallDir
$code = $LASTEXITCODE
if ($code -ne 0) {
    Write-Host ""
    Write-Host "[FAIL] Smoke test fallido (exit $code)." -ForegroundColor Red
    exit $code
}
Write-Host "[OK] Smoke test superado." -ForegroundColor Green
exit 0
