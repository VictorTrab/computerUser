param(
    [switch]$PurgeFiles = $false
)

$ErrorActionPreference = 'SilentlyContinue'

# Identidad propia de ComputerUser (independiente de Codex/OpenAI)
$NativeHostName = "com.victortrab.computeruser"
$LegacyHostName = "com.openai.codexextension"

Write-Host ""
Write-Host "=== Desinstalador de Free Computer User ===" -ForegroundColor Yellow
Write-Host ""

# 1. Eliminar registros de Native Messaging Host
Write-Host "[1/5] Desregistrando Native Messaging Hosts de navegadores..." -ForegroundColor Gray
$browserRegRoots = @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts",
    "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts"
)

foreach ($root in $browserRegRoots) {
    # Nuestro host propio: se elimina siempre.
    $ownKey = Join-Path $root $NativeHostName
    if (Test-Path $ownKey) {
        Remove-Item -Path $ownKey -Recurse -Force
        Write-Host "  [OK] Eliminado $ownKey" -ForegroundColor Green
    }

    # Nombre heredado: se elimina SOLO si apunta a nuestra instalacion, para no
    # romper nunca el native host de la app Codex si esta instalada.
    $legacyKey = Join-Path $root $LegacyHostName
    if (Test-Path $legacyKey) {
        $legacyValue = (Get-ItemProperty -Path $legacyKey -ErrorAction SilentlyContinue).'(default)'
        if ($legacyValue -and ($legacyValue -match "computerUser|free-computer-user")) {
            Remove-Item -Path $legacyKey -Recurse -Force
            Write-Host "  [OK] Eliminada entrada heredada $legacyKey" -ForegroundColor Green
        } else {
            Write-Host "  (Se conserva ${legacyKey}: pertenece a la app Codex)" -ForegroundColor DarkGray
        }
    }
}

# 2. Eliminar Skills globales
Write-Host "[2/5] Eliminando skills de ~/.agents/skills y ~/.dsh/skills..." -ForegroundColor Gray
$skillNames = @(
    "free-computer-user",
    "free-control-browser",
    "free-control-chrome",
    "free-control-brave",
    "free-control-edge",
    "computer-use-windows",
    "control-chrome"
)
$skillPaths = @()
foreach ($n in $skillNames) {
    $skillPaths += (Join-Path $env:USERPROFILE ".agents\skills\$n")
    $skillPaths += (Join-Path $env:USERPROFILE ".dsh\skills\$n")
}

foreach ($sp in $skillPaths) {
    if (Test-Path $sp) {
        Remove-Item -Path $sp -Recurse -Force
        Write-Host "  [OK] Eliminado $sp" -ForegroundColor Green
    }
}

# 3. Limpiar DeepSeek Harness (cordis.patch.yml)
Write-Host "[3/5] Limpiando configuracion en DeepSeek Harness..." -ForegroundColor Gray
$cordisPatch = Join-Path $env:USERPROFILE ".dsh\profiles\desktop\cordis.patch.yml"
if (Test-Path $cordisPatch) {
    $content = Get-Content $cordisPatch -Raw
    if ($content -match "mcp-computer-user") {
        $cleaned = $content -replace "(?ms)- id: mcp-computer-user.*?version: `"[^`"]+`"\r?\n?", ""
        Set-Content -Path $cordisPatch -Value $cleaned -Encoding UTF8
        Write-Host "  [OK] Removido de cordis.patch.yml." -ForegroundColor Green
    }
}

# 4. Limpiar Antigravity
Write-Host "[4/5] Limpiando configuracion en Antigravity..." -ForegroundColor Gray
$antigravityMcpConfig = Join-Path $env:USERPROFILE ".gemini\antigravity\mcp_config.json"
if (Test-Path $antigravityMcpConfig) {
    try {
        $json = Get-Content $antigravityMcpConfig -Raw | ConvertFrom-Json
        if ($json.mcpServers."computer-user") {
            $json.mcpServers.PSObject.Properties.Remove("computer-user")
            $json | ConvertTo-Json -Depth 6 | Set-Content $antigravityMcpConfig -Encoding UTF8
            Write-Host "  [OK] Removido de mcp_config.json de Antigravity." -ForegroundColor Green
        }
    } catch {}
}

# 5. Remover comando del PATH del Usuario
Write-Host "[5/5] Removiendo 'free-computer-user' del PATH de Windows..." -ForegroundColor Gray
$pathsToRemove = @(
    (Join-Path (Resolve-Path "$PSScriptRoot\..").Path "bin"),
    (Join-Path $env:USERPROFILE ".free-computer-user\bin"),
    (Join-Path $env:USERPROFILE ".agents\computerUser\bin")
)
$currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathList = $currentUserPath -split ';' | Where-Object { $pathsToRemove -notcontains $_ -and $_ }
[Environment]::SetEnvironmentVariable("Path", ($pathList -join ';'), "User")
Write-Host "  [OK] Removido del PATH de Windows." -ForegroundColor Green

if ($PurgeFiles) {
    $engineFolder = Join-Path $env:USERPROFILE ".free-computer-user"
    if (Test-Path $engineFolder) {
        Remove-Item -Recurse -Force $engineFolder
        Write-Host "  [OK] Eliminada carpeta del motor: $engineFolder" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "[OK] Desinstalacion completada exitosamente." -ForegroundColor Green
Write-Host "Nota: Puedes quitar la extension 'ComputerUser Browser Bridge' desde chrome://extensions haciendo clic en 'Quitar'." -ForegroundColor Yellow
