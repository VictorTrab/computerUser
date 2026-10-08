param(
    [string]$InstallDir = ""
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "=== Actualizador de ComputerUser ===" -ForegroundColor Cyan
Write-Host ""

if (-not $InstallDir) {
    if (Test-Path "$PSScriptRoot\..\runtime") {
        $InstallDir = (Resolve-Path "$PSScriptRoot\..").Path
    } else {
        $InstallDir = Join-Path $env:USERPROFILE ".free-computer-user"
    }
}

if (-not (Test-Path $InstallDir)) {
    throw "No se encontro la instalacion de ComputerUser en $InstallDir."
}

# 1. Actualizar desde Git si existe .git
if (Test-Path "$InstallDir\.git") {
    Write-Host "Obteniendo ultimas mejoras desde GitHub..." -ForegroundColor Cyan
    Push-Location $InstallDir
    try {
        git pull --rebase
    } finally {
        Pop-Location
    }
} else {
    Write-Host "Directorio no administrado por Git, omitiendo git pull." -ForegroundColor Gray
}

# 2. Re-ejecutar script de instalacion para sincronizar rutas y skills
Write-Host "Sincronizando configuracion y skills..." -ForegroundColor Cyan
& "$InstallDir\scripts\install.ps1" -InstallDir $InstallDir

Write-Host ""
Write-Host "[OK] ComputerUser se ha actualizado correctamente." -ForegroundColor Green
Write-Host "Si hubo cambios en la extension, recuerda presionar el boton de recargar (🔄) en chrome://extensions." -ForegroundColor Yellow
