@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%.."

if "%~1"=="" goto help
if /i "%~1"=="doctor" goto doctor
if /i "%~1"=="update" goto update
if /i "%~1"=="uninstall" goto uninstall
if /i "%~1"=="version" goto version
if /i "%~1"=="--version" goto version
if /i "%~1"=="-v" goto version
if /i "%~1"=="help" goto help
if /i "%~1"=="--help" goto help
if /i "%~1"=="-h" goto help

echo [ERROR] Comando no reconocido: %~1
echo.
goto help

:doctor
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT_DIR%\scripts\doctor.ps1"
goto end

:update
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT_DIR%\scripts\update.ps1"
goto end

:uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT_DIR%\scripts\uninstall.ps1"
goto end

:version
echo free-computer-user v1.0.5
goto end

:help
echo ==========================================================
echo           FREE COMPUTER USER - CLI DE MANTENIMIENTO
echo ==========================================================
echo.
echo Uso:
echo   free-computer-user doctor         Verifica el estado de salud y dependencias
echo   free-computer-user update         Actualiza desde GitHub y refresca las skills
echo   free-computer-user uninstall      Desinstala limpiamente el motor y registros
echo   free-computer-user --version      Muestra la version instalada
echo   free-computer-user help           Muestra este menu de ayuda
echo.
goto end

:end
endlocal
