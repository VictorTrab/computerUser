param(
    # El borrado de la carpeta de instalacion es el paso 6 y ya no es opcional:
    # usa -PurgeFiles:$false si quieres desinstalar conservando los ficheros.
    [switch]$PurgeFiles = $true
)

$ErrorActionPreference = 'SilentlyContinue'

# Identidad propia de ComputerUser (independiente de Codex/OpenAI)
$NativeHostName = "com.victortrab.computeruser"
$LegacyHostName = "com.openai.codexextension"

Write-Host ""
Write-Host "=== Desinstalador de Free Computer User ===" -ForegroundColor Yellow
Write-Host ""

# 1. Eliminar registros de Native Messaging Host
Write-Host "[1/6] Desregistrando Native Messaging Hosts de navegadores..." -ForegroundColor Gray
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
Write-Host "[2/6] Eliminando skills de ~/.agents/skills y ~/.dsh/skills..." -ForegroundColor Gray
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
Write-Host "[3/6] Limpiando configuracion en DeepSeek Harness..." -ForegroundColor Gray
$cordisPatch = Join-Path $env:USERPROFILE ".dsh\profiles\desktop\cordis.patch.yml"
if (Test-Path $cordisPatch) {
    $content = Get-Content $cordisPatch -Raw
    if ($content -match "mcp-computer-user") {
        # El bloque generado por el instalador no siempre termina en `version:`,
        # asi que se recorta hasta el siguiente `- id:` de primer nivel o el final.
        $cleaned = [regex]::Replace($content, '(?ms)^- id: mcp-computer-user[ \t]*\r?\n.*?(?=^- id: |\z)', '')
        $cleaned = $cleaned -replace '(\r?\n){3,}', "`r`n`r`n"
        [System.IO.File]::WriteAllText($cordisPatch, $cleaned, (New-Object System.Text.UTF8Encoding($false)))
        if ($cleaned -match "mcp-computer-user") {
            Write-Host "  [AVISO] No se pudo eliminar el bloque mcp-computer-user; revisa $cordisPatch" -ForegroundColor DarkYellow
        } else {
            Write-Host "  [OK] Removido de cordis.patch.yml." -ForegroundColor Green
        }
    }
}

# 4. Limpiar Antigravity
Write-Host "[4/6] Limpiando configuracion en Antigravity..." -ForegroundColor Gray
# Esta version de Antigravity lee ~/.gemini/config/mcp_config.json; la ruta antigua
# se limpia tambien para no dejar la entrada en instalaciones previas. Se escribe sin
# BOM: un BOM al principio rompe el parseo JSON de la app.
$antigravityMcpConfigs = @(
    (Join-Path $env:USERPROFILE ".gemini\config\mcp_config.json"),
    (Join-Path $env:USERPROFILE ".gemini\antigravity\mcp_config.json")
)
foreach ($antigravityMcpConfig in $antigravityMcpConfigs) {
    if (-not (Test-Path $antigravityMcpConfig)) { continue }
    try {
        $json = Get-Content $antigravityMcpConfig -Raw | ConvertFrom-Json
        if ($json.mcpServers."computer-user") {
            $json.mcpServers.PSObject.Properties.Remove("computer-user")
            [System.IO.File]::WriteAllText($antigravityMcpConfig, ($json | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
            Write-Host "  [OK] Removido de $antigravityMcpConfig." -ForegroundColor Green
        }
    } catch {}
}

# 5. Remover comando del PATH del Usuario
Write-Host "[5/6] Removiendo 'free-computer-user' del PATH de Windows..." -ForegroundColor Gray
$pathsToRemove = @(
    (Join-Path (Resolve-Path "$PSScriptRoot\..").Path "bin"),
    (Join-Path $env:USERPROFILE ".free-computer-user\bin"),
    (Join-Path $env:USERPROFILE ".agents\computerUser\bin")
)
$currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathList = $currentUserPath -split ';' | Where-Object { $pathsToRemove -notcontains $_ -and $_ }
[Environment]::SetEnvironmentVariable("Path", ($pathList -join ';'), "User")
Write-Host "  [OK] Removido del PATH de Windows." -ForegroundColor Green

# 6. Eliminar la carpeta de instalacion (~/.free-computer-user)
Write-Host "[6/6] Eliminando la carpeta de instalacion..." -ForegroundColor Gray
$engineFolder = Join-Path $env:USERPROFILE ".free-computer-user"
# Solo se borra si la ruta es exactamente la esperada: asi un USERPROFILE
# inesperado, una junction o un enlace simbolico nunca borran otra carpeta.
$expectedFolder = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".free-computer-user")).TrimEnd('\')
$purgeFailed = $false

if (-not $PurgeFiles) {
    Write-Host "  (Se conserva ${engineFolder}: se ejecuto con -PurgeFiles:`$false)" -ForegroundColor DarkGray
} elseif (-not (Test-Path -LiteralPath $engineFolder)) {
    Write-Host "  [OK] No existe $engineFolder (nada que eliminar)" -ForegroundColor Green
} else {
    $resolvedFolder = ""
    $isReparse = $false
    try {
        $engineItem = Get-Item -LiteralPath $engineFolder -Force -ErrorAction Stop
        # Resolve-Path no sigue las junctions en PowerShell 5.1, asi que se mira
        # el atributo ReparsePoint para no borrar nunca el destino de un enlace.
        $isReparse = (($engineItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
        $resolvedFolder = [System.IO.Path]::GetFullPath($engineItem.FullName).TrimEnd('\')
    } catch {
        $resolvedFolder = ""
    }

    if (-not $resolvedFolder -or $isReparse -or ($resolvedFolder -ne $expectedFolder)) {
        $purgeFailed = $true
        if ($isReparse) {
            Write-Host "  [AVISO] $engineFolder es un enlace (junction/symlink) -> $($engineItem.Target)" -ForegroundColor DarkYellow
            Write-Host "          Un enlace no se borra automaticamente: puede apuntar fuera de la instalacion." -ForegroundColor DarkYellow
        } else {
            Write-Host "  [AVISO] Ruta resuelta inesperada: '$resolvedFolder'" -ForegroundColor DarkYellow
            Write-Host "          Se esperaba exactamente: $expectedFolder" -ForegroundColor DarkYellow
        }
        Write-Host "          No se ha borrado nada. Revisa esa carpeta a mano." -ForegroundColor DarkYellow
    } else {
        # Los navegadores dejan vivo un extension-host.exe dentro de la instalacion;
        # si sigue en ejecucion, el archivo queda bloqueado y el borrado falla en
        # silencio. Se detienen solo los procesos que corren desde esta carpeta.
        # Orden obligatorio: primero matar procesos, despues borrar.
        $running = @()
        $running = Get-CimInstance Win32_Process -Filter "Name='extension-host.exe' or Name='node_repl.exe' or Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($engineFolder, [System.StringComparison]::OrdinalIgnoreCase) }
        foreach ($proc in $running) {
            try {
                Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
                Write-Host "  [OK] Detenido proceso en uso: $($proc.Name) (PID $($proc.ProcessId))" -ForegroundColor DarkGray
                Start-Sleep -Milliseconds 400
            } catch {
                Write-Host "  [AVISO] No se pudo detener $($proc.Name) (PID $($proc.ProcessId)): $_" -ForegroundColor DarkYellow
            }
        }

        Remove-Item -LiteralPath $engineFolder -Recurse -Force -ErrorAction SilentlyContinue

        if (Test-Path -LiteralPath $engineFolder) {
            # Nunca se dice que fue bien si quedan restos: se listan los primeros.
            $purgeFailed = $true
            $left = Get-ChildItem -LiteralPath $engineFolder -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 5 -ExpandProperty FullName
            Write-Host "  [AVISO] No se pudo eliminar por completo $engineFolder" -ForegroundColor DarkYellow
            Write-Host "          Restos: $($left -join ', ')" -ForegroundColor DarkYellow
            Write-Host "          Cierra los navegadores y repite, o borra la carpeta a mano." -ForegroundColor DarkYellow
        } else {
            Write-Host "  [OK] Eliminada carpeta del motor: $engineFolder" -ForegroundColor Green
        }
    }
}

Write-Host ""
if ($purgeFailed) {
    Write-Host "[AVISO] Desinstalacion completada, pero quedan restos en $engineFolder (ver arriba)." -ForegroundColor DarkYellow
} else {
    Write-Host "[OK] Desinstalacion completada exitosamente." -ForegroundColor Green
}
Write-Host "Nota: Puedes quitar la extension 'Skynet Bridge' desde chrome://extensions haciendo clic en 'Quitar'." -ForegroundColor Yellow
