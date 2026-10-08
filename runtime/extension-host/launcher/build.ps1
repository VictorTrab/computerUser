# Compila el lanzador nativo del host propio de ComputerUser.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File launcher\build.ps1
#
# Requiere rustc (sin cargo, sin crates, sin red). Salida:
#   runtime\extension-host\windows\x64\extension-host.exe
$ErrorActionPreference = 'Stop'

$hostDir = (Resolve-Path "$PSScriptRoot\..").Path
$source  = Join-Path $PSScriptRoot "extension-host.rs"
$outDir  = Join-Path $hostDir "windows\x64"
$outExe  = Join-Path $outDir "extension-host.exe"

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$rustc = (Get-Command rustc -ErrorAction SilentlyContinue).Source
if (-not $rustc) {
    foreach ($candidate in @("$env:USERPROFILE\.cargo\bin\rustc.exe", "C:\Users\User\.cargo\bin\rustc.exe")) {
        if (Test-Path $candidate) { $rustc = $candidate; break }
    }
}
if (-not $rustc) { throw "No se encontro rustc.exe (instala Rust o pasa la ruta a mano)." }

Write-Host "Compilando $source -> $outExe"
& $rustc -O -o $outExe $source
if ($LASTEXITCODE -ne 0) { throw "rustc fallo con exit code $LASTEXITCODE" }

$size = [math]::Round((Get-Item $outExe).Length / 1KB, 0)
Write-Host "[OK] Lanzador compilado ($size KB): $outExe"
Write-Host "     (el original de Codex se conserva como extension-host.exe.bak-codex)"
