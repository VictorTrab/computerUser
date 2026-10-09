<#
.SYNOPSIS
    CLI de administración y diagnóstico para Free Computer User.
#>
param(
    [Parameter(Position=0)]
    [string]$Action = "help",
    [switch]$v,
    [switch]$version
)

$RootDir = (Resolve-Path "$PSScriptRoot\..").Path
$VersionNumber = "1.0.13"

if ($v.IsPresent -or $version.IsPresent -or ($Action -in "version", "--version", "-v", "-version")) {
    Write-Host "free-computer-user v$VersionNumber"
    exit 0
}

switch ($Action.ToLower()) {
    "doctor" {
        & "$RootDir\scripts\doctor.ps1"
    }
    "update" {
        & "$RootDir\scripts\update.ps1"
    }
    "uninstall" {
        & "$RootDir\scripts\uninstall.ps1"
    }
    default {
        Write-Host ""
        Write-Host "==========================================================" -ForegroundColor Cyan
        Write-Host "          FREE COMPUTER USER - CLI DE MANTENIMIENTO       " -ForegroundColor Yellow
        Write-Host "==========================================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Uso:" -ForegroundColor White
        Write-Host "  free-computer-user doctor         " -ForegroundColor Green -NoNewline
        Write-Host "Verifica el estado de salud y dependencias"
        Write-Host "  free-computer-user update         " -ForegroundColor Green -NoNewline
        Write-Host "Actualiza desde GitHub y refresca las skills"
        Write-Host "  free-computer-user uninstall      " -ForegroundColor Green -NoNewline
        Write-Host "Desinstala limpiamente el motor y registros"
        Write-Host "  free-computer-user --version      " -ForegroundColor Green -NoNewline
        Write-Host "Muestra la versión instalada"
        Write-Host "  free-computer-user help           " -ForegroundColor Green -NoNewline
        Write-Host "Muestra este menú de ayuda"
        Write-Host ""
    }
}
