@echo off
rem Lanzador de consola: delega en run_mcp.ps1 para no duplicar el entorno.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_mcp.ps1" %*
