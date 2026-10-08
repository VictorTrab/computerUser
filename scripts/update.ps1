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

# 1. Actualizar desde Release o Git
$releaseZipUrl = "https://github.com/VictorTrab/computerUser/releases/latest/download/free-computer-user-windows-x64.zip"
$tempZip = Join-Path $env:TEMP "free-computer-user-update.zip"
$updatedViaRelease = $false

Write-Host "Comprobando ultima version en GitHub Releases..." -ForegroundColor Cyan
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $releaseZipUrl -OutFile $tempZip -UseBasicParsing -ErrorAction Stop
    if ((Test-Path $tempZip) -and (Get-Item $tempZip).Length -gt 1000000) {
        Write-Host "Aplicando actualizacion en $InstallDir..." -ForegroundColor Cyan
        Expand-Archive -Path $tempZip -DestinationPath $InstallDir -Force
        Remove-Item -Force $tempZip -ErrorAction SilentlyContinue
        $updatedViaRelease = $true
        Write-Host "  [OK] Actualizacion aplicada desde release oficial." -ForegroundColor Green
    }
} catch {
    Write-Host "  (Aviso: Release no disponible o error de red, intentando Git si existe...)" -ForegroundColor DarkYellow
}

if (-not $updatedViaRelease -and (Test-Path "$InstallDir\.git")) {
    Write-Host "Actualizando via Git..." -ForegroundColor Cyan
    Push-Location $InstallDir
    try {
        git pull --rebase
    } finally {
        Pop-Location
    }
}

# 2. Re-ejecutar script de instalacion para sincronizar rutas y skills
Write-Host "Sincronizando configuracion y skills..." -ForegroundColor Cyan
& "$InstallDir\scripts\install.ps1" -InstallDir $InstallDir

Write-Host ""
Write-Host "[OK] ComputerUser se ha actualizado correctamente." -ForegroundColor Green
Write-Host "Si hubo cambios en la extension, recuerda presionar el boton de recargar (🔄) en chrome://extensions." -ForegroundColor Yellow
