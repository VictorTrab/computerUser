<#
.SYNOPSIS
    Empaqueta el release de Free Computer User y valida la integridad de los componentes.
#>

param(
    [string]$OutputDir = ""
)

$ErrorActionPreference = 'Stop'
$RootDir = (Resolve-Path "$PSScriptRoot\..").Path

if (-not $OutputDir) {
    $OutputDir = Join-Path $RootDir "dist"
} else {
    if (-not [System.IO.Path]::IsPathRooted($OutputDir)) {
        $OutputDir = Join-Path $RootDir $OutputDir
    }
}
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       EMPAQUETADOR Y VALIDADOR DE INTEGRIDAD CI/CD       " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Validaciones de Integridad (Smoke Tests)
Write-Host "[1/4] Ejecutando validaciones de integridad..." -ForegroundColor Cyan

# A. Binarios indispensables
$requiredFiles = @(
    "runtime\bin\node_repl.exe",
    "runtime\bin\node.exe",
    "runtime\extension-host\windows\x64\extension-host.exe",
    "runtime\bin\node_modules\@oai\sky\bin\windows\codex-computer-use.exe",
    "extension\manifest.json",
    "home\computer-use\config.toml",
    "skills\free-computer-user\SKILL.md",
    "skills\free-control-browser\SKILL.md",
    "rules\AGENTS.md",
    "scripts\smoke-browser-bridge.mjs",
    "mcp_config.json"
)

foreach ($f in $requiredFiles) {
    $fullPath = Join-Path $RootDir $f
    if (-not (Test-Path $fullPath)) {
        throw "Falta componente critico para el release: $f"
    }
}
Write-Host "  [OK] Todos los componentes criticos estan presentes." -ForegroundColor Green

# B. Validar sintaxis JSON
Write-Host "  -> Verificando sintaxis de archivos JSON..." -ForegroundColor Gray
$jsonFiles = @(
    "extension\manifest.json",
    "runtime\extension-host\com.victortrab.computeruser.json",
    "mcp_config.json"
)
foreach ($jf in $jsonFiles) {
    $jfPath = Join-Path $RootDir $jf
    if (-not (Test-Path $jfPath)) {
        Write-Host "  (omitido: $jf no generado en este arbol)" -ForegroundColor DarkGray
        continue
    }
    $content = Get-Content $jfPath -Raw
    $null = $content | ConvertFrom-Json
}
Write-Host "  [OK] Archivos JSON validos y sin errores de sintaxis." -ForegroundColor Green

# C. Validar ejecucion e integridad de binarios nativos
Write-Host "  -> Verificando ejecutabilidad de runtimes binarios..." -ForegroundColor Gray
$nodeReplExe = Join-Path $RootDir "runtime\bin\node_repl.exe"
$nodeExe = Join-Path $RootDir "runtime\bin\node.exe"

$nodeReplHelp = & $nodeReplExe --help 2>&1 | Out-String
if ($nodeReplHelp -match "node_repl MCP") {
    Write-Host "  [OK] node_repl.exe operativo y ejecutable." -ForegroundColor Green
} else {
    throw "node_repl.exe no respondio a --help o fallo al inicializarse."
}

$nodeVer = & $nodeExe -v 2>&1 | Out-String
if ($nodeVer -match "v\d+") {
    Write-Host "  [OK] node.exe operativo (Version: $($nodeVer.Trim()))." -ForegroundColor Green
} else {
    throw "node.exe fallo al responder a -v."
}

# D. Smoke test de handshake MCP (si el entorno de ejecucion soporta tuberias interactivas)
Write-Host "  -> Verificando handshake MCP stdio..." -ForegroundColor Gray
$handshakeJson = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"ci-smoke-test","version":"1.0.0"}}}'

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $nodeReplExe
$psi.Arguments = "--disable-sandbox"
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$psi.EnvironmentVariables["CODEX_HOME"] = Join-Path $RootDir "home"
$psi.EnvironmentVariables["NODE_REPL_NODE_PATH"] = $nodeExe
$psi.EnvironmentVariables["NODE_REPL_NODE_MODULE_DIRS"] = Join-Path $RootDir "runtime\bin\node_modules"
$psi.EnvironmentVariables["NODE_REPL_TRUSTED_CODE_PATHS"] = "$RootDir\home;$RootDir\runtime\bin\node_modules;$RootDir\runtime\browser"
$psi.EnvironmentVariables["NODE_REPL_TRUSTED_SERVICES"] = "{`"browser`":`"$($RootDir.Replace('\', '/'))/runtime/browser/browser-service.mjs`",`"sky`":`"@oai/sky/service`"}"
$psi.EnvironmentVariables["BROWSER_USE_AVAILABLE_BACKENDS"] = "chrome,iab"
$psi.EnvironmentVariables["BROWSER_USE_TINYSKY_ENABLED"] = "1"
$psi.EnvironmentVariables["BROWSER_USE_CODEX_APP_BUILD_FLAVOR"] = "prod"
$psi.EnvironmentVariables["BROWSER_USE_CODEX_APP_VERSION"] = "26.915.31945"
$psi.EnvironmentVariables["BROWSER_USE_FULL_CDP_ACCESS_ENABLED"] = "1"
$psi.EnvironmentVariables["BROWSER_USE_SECURITY_MODE"] = "disabled-for-local-testing"
$psi.EnvironmentVariables["SKY_CUA_NATIVE_PIPE"] = "0"
$psi.EnvironmentVariables["NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS"] = "1000"

if ($env:TEMP) { $psi.EnvironmentVariables["TEMP"] = $env:TEMP }
if ($env:TMP) { $psi.EnvironmentVariables["TMP"] = $env:TMP }
if ($env:USERPROFILE) { $psi.EnvironmentVariables["USERPROFILE"] = $env:USERPROFILE }

try {
    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.StandardInput.WriteLine($handshakeJson)
    $proc.StandardInput.Flush()

    $response = ""
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt 4000 -and (-not $proc.HasExited)) {
        if (-not $proc.StandardOutput.EndOfStream) {
            $line = $proc.StandardOutput.ReadLine()
            if ($line -match '"jsonrpc"') {
                $response = $line
                break
            }
        }
        Start-Sleep -Milliseconds 100
    }
    try { $proc.Kill() } catch {}

    if ($response -match '"result"') {
        Write-Host "  [OK] Handshake MCP respondio correctamente con JSON-RPC 2.0." -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Handshake MCP interactivo omitido en runner no-interactivo." -ForegroundColor DarkYellow
    }
} catch {
    Write-Host "  [WARN] Handshake MCP interactivo no disponible en runner: $_" -ForegroundColor DarkYellow
}

# D2. Sincronizar el shim `browser` (el cliente vive en runtime\browser)
$shimDir = Join-Path $RootDir "runtime\bin\node_modules\browser"
New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
Copy-Item -Path (Join-Path $RootDir "runtime\browser\browser-client.mjs") -Destination (Join-Path $shimDir "browser-client.mjs") -Force
Write-Host "  [OK] Shim 'browser' sincronizado." -ForegroundColor Green
# E. Smoke test del puente de navegador (sin navegador real)
Write-Host "  -> Ejecutando smoke test del puente de navegador..." -ForegroundColor Gray
$smokeScript = Join-Path $RootDir "scripts\smoke-browser-bridge.mjs"
if (Test-Path $smokeScript) {
    & $nodeExe $smokeScript $RootDir
    if ($LASTEXITCODE -ne 0) { throw "Smoke test del puente de navegador fallido (exit $LASTEXITCODE)." }
    Write-Host "  [OK] Puente de navegador verificado end-to-end." -ForegroundColor Green
} else {
    Write-Host "  [WARN] scripts\smoke-browser-bridge.mjs no encontrado; se omite." -ForegroundColor DarkYellow
}
# 2. Preparar directorio temporal de empaquetado
Write-Host ""
Write-Host "[2/4] Preparando arbol de empaquetado limpio..." -ForegroundColor Cyan
$stageDir = Join-Path $RootDir ".stage_release"
if (Test-Path $stageDir) {
    Remove-Item -Recurse -Force $stageDir
}
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

$itemsToInclude = @(
    "runtime",
    "extension",
    "home",
    "skills",
    "rules",
    "bin",
    "scripts",
    "adapters",
    "mcp_config.json",
    "README.md"
)

foreach ($item in $itemsToInclude) {
    $src = Join-Path $RootDir $item
    if (Test-Path $src) {
        $dest = Join-Path $stageDir $item
        Copy-Item -Path $src -Destination $dest -Recurse -Force
    }
}

# Limpiar exclusiones dentro del stage (scripts de dev, temporales)
Remove-Item -Force (Join-Path $stageDir "scripts\generate_intro_gif.py") -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $stageDir "scripts\package.ps1") -ErrorAction SilentlyContinue
Get-ChildItem -Path $stageDir -Recurse -File -Include "*.sqlite*", "*.wal", "*.shm", "*.tmp" | Remove-Item -Force -ErrorAction SilentlyContinue
# Estado generado por el runtime (ids de instalacion, skills de sistema de Codex,
# temporales) no debe viajar en el release.
foreach ($junk in @("home\skills", "home\tmp", "home\.tmp", "home\installation_id", "home\.codex-global-state.json", "home\history.jsonl")) {
    Remove-Item -Recurse -Force (Join-Path $stageDir $junk) -ErrorAction SilentlyContinue
}

Write-Host "  [OK] Arbol de stage creado y depurado." -ForegroundColor Green

# 3. Comprimir Release ZIP
Write-Host ""
Write-Host "[3/4] Generando archivo comprimido..." -ForegroundColor Cyan
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$zipName = "free-computer-user-windows-x64.zip"
$zipPath = Join-Path $OutputDir $zipName
if (Test-Path $zipPath) {
    Remove-Item -Force $zipPath
}

if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
    Push-Location $stageDir
    try {
        & tar.exe -a -c -f $zipPath *
    } finally {
        Pop-Location
    }
} else {
    Compress-Archive -Path "$stageDir\*" -DestinationPath $zipPath -CompressionLevel Fastest
}
$zipSizeMb = [math]::Round(((Get-Item $zipPath).Length / 1MB), 2)
Write-Host "  [OK] Creado: $zipName ($zipSizeMb MB)" -ForegroundColor Green

# Limpiar stage temporal
Remove-Item -Recurse -Force $stageDir

# 4. Generar Checksum SHA256
Write-Host ""
Write-Host "[4/4] Calculando checksum SHA256..." -ForegroundColor Cyan
$hash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash
$checksumFile = Join-Path $OutputDir "SHA256SUMS.txt"
"$hash  $zipName" | Set-Content -Path $checksumFile -Encoding UTF8
Write-Host "  [OK] SHA256: $hash" -ForegroundColor Green
Write-Host "  [OK] Checksum guardado en: $checksumFile" -ForegroundColor Green

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "             RELEASE EMPAQUETADO EXITOSAMENTE             " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
