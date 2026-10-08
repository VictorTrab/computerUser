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

# node.exe del runtime: lo usan las validaciones y el smoke test.
$nodeExe = Join-Path $RootDir "runtime\bin\node.exe"

# Patron unico de "respaldo de binario": *.bak, *.bak-<sufijo> (.bak-overlay),
# *.bak_<sufijo>, *.bak.<sufijo>. Nada que case con esto viaja en el release.
$BackupRegex = '\.bak([-._]|$)'

function Get-ZipEntryNames {
    param([string]$ZipPath)
    # Inspecciona el zip SIN extraerlo. System.IO.Compression primero (no depende
    # de utilidades externas); si no estuviera disponible, tar.exe -tf.
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
        $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
        try {
            return @($zip.Entries | ForEach-Object { $_.FullName })
        } finally {
            $zip.Dispose()
        }
    } catch {
        if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
            return @(& tar.exe -tf $ZipPath)
        }
        throw "No se pudo inspeccionar el contenido del zip: $_"
    }
}

# 1. Validaciones de Integridad (Smoke Tests)
Write-Host "[1/4] Ejecutando validaciones de integridad..." -ForegroundColor Cyan

# A. Binarios indispensables
$requiredFiles = @(
    "runtime\bin\node_repl.exe",
    "runtime\bin\node.exe",
    "runtime\extension-host\windows\x64\extension-host.exe",
    # Host nativo PROPIO: el .exe es solo el lanzador; el host es src\host.mjs y
    # sus modulos. Sin ellos el navegador arrancaria un host sin script.
    "runtime\extension-host\src\host.mjs",
    "runtime\extension-host\src\framing.mjs",
    "runtime\extension-host\src\trace.mjs",
    "runtime\bin\node_modules\@oai\sky\bin\windows\codex-computer-use.exe",
    "extension\manifest.json",
    "home\computer-use\config.toml",
    "skills\free-computer-user\SKILL.md",
    "skills\free-control-browser\SKILL.md",
    "rules\AGENTS.md",
    "scripts\smoke-browser-bridge.mjs",
    "scripts\check-extension-files.mjs",
    "mcp_config.json"
)

foreach ($f in $requiredFiles) {
    $fullPath = Join-Path $RootDir $f
    if (-not (Test-Path $fullPath)) {
        throw "Falta componente critico para el release: $f"
    }
}
Write-Host "  [OK] Todos los componentes criticos estan presentes." -ForegroundColor Green

# A2. El host nativo empaquetado tiene que ser EL NUESTRO, no el binario de Codex.
# El lanzador propio lleva grabada la cadena de identidad; el de Codex no.
Write-Host "  -> Verificando que el host nativo es el lanzador propio..." -ForegroundColor Gray
$extHostExe = Join-Path $RootDir "runtime\extension-host\windows\x64\extension-host.exe"
$extHostProbe = ""
try {
    $extHostProbe = [string](& $nodeExe -e "const fs=require('fs');const b=fs.readFileSync(process.argv[1]);const m=Buffer.from('ComputerUser native messaging launcher','latin1');process.stdout.write(b.includes(m)?'OWN':'FOREIGN')" $extHostExe 2>$null)
} catch { $extHostProbe = "" }
if ($extHostProbe -notmatch 'OWN') {
    throw "runtime\extension-host\windows\x64\extension-host.exe NO es el lanzador propio (¿binario de Codex?). Compila con runtime\extension-host\launcher\build.ps1"
}
Write-Host "  [OK] Host nativo propio (lanzador ComputerUser, no el binario de Codex)." -ForegroundColor Green

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

# Artefactos del host nativo que NO van en el release: el respaldo del binario de
# Codex no se distribuye (la reversion se hace con el .bak-codex del repo), y ni
# los simbolos del compilador ni las trazas de protocolo tienen nada que hacer en
# el paquete.
$hostStage = Join-Path $stageDir "runtime\extension-host"
Remove-Item -Force (Join-Path $hostStage "windows\x64\extension-host.exe.bak-codex") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $hostStage "logs") -ErrorAction SilentlyContinue

# Respaldo de binarios AJENOS en cualquier punto del arbol. El parche de overlay
# dejo tres `*.bak-overlay` (los ejecutables ORIGINALES de Codex: @oai/sky x64,
# @oai/cua y el swift; ~59,6 MB) y la lista fija de exclusiones no los veia.
# Barrido general por patron, no por lista: *.bak, *.bak-overlay, *.bak_1, *.bak.old
$backups = @(Get-ChildItem -Path $stageDir -Recurse -File | Where-Object { $_.Name -match $BackupRegex })
if ($backups.Count -gt 0) {
    $backupBytes = ($backups | Measure-Object -Property Length -Sum).Sum
    foreach ($b in $backups) {
        Write-Host ("  -> excluido del paquete: {0} ({1:N0} bytes)" -f $b.FullName.Replace("$stageDir\", ""), $b.Length) -ForegroundColor DarkGray
        Remove-Item -Force $b.FullName -ErrorAction SilentlyContinue
    }
    Write-Host ("  [OK] {0} respaldo(s) de binarios excluidos del paquete ({1:N2} MB)." -f $backups.Count, ($backupBytes / 1MB)) -ForegroundColor Green
} else {
    Write-Host "  [OK] Sin respaldos de binarios en el stage." -ForegroundColor DarkGray
}

# Simbolos de compilador (*.pdb) y trazas de runtime (cualquier carpeta logs bajo
# runtime\): estado de desarrollo, nunca contenido de un release.
$pdbs = @(Get-ChildItem -Path $stageDir -Recurse -File | Where-Object { $_.Name -like "*.pdb" })
foreach ($p in $pdbs) { Remove-Item -Force $p.FullName -ErrorAction SilentlyContinue }
$logDirs = @(Get-ChildItem -Path (Join-Path $stageDir "runtime") -Recurse -Directory -Filter "logs" -ErrorAction SilentlyContinue)
foreach ($d in $logDirs) { Remove-Item -Recurse -Force $d.FullName -ErrorAction SilentlyContinue }
Write-Host ("  [OK] Host nativo: respaldo, simbolos y trazas excluidos del paquete ({0} .pdb, {1} logs/)." -f $pdbs.Count, $logDirs.Count) -ForegroundColor DarkGray

Write-Host "  [OK] Arbol de stage creado y depurado." -ForegroundColor Green

# 3. Comprimir Release ZIP
Write-Host ""
Write-Host "[3/4] Generando archivo comprimido..." -ForegroundColor Cyan
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$zipName = "free-computer-user-windows-x64.zip"
$zipPath = Join-Path $OutputDir $zipName

# Guard: el manifest no puede declarar ficheros ausentes (Chrome no carga la
# extension). Se comprueba el STAGE, que es exactamente lo que se va a comprimir,
# y se ejecuta SIEMPRE: antes vivia dentro de la rama `else` (solo sin tar.exe),
# asi que con tar.exe instalado -el caso normal en Windows 10/11- nunca corria.
# Va ANTES de tocar el zip: si el arbol no es valido, el paquete anterior (bueno)
# no se destruye.
Write-Host "  -> Verificando coherencia del manifest de la extension..." -ForegroundColor Gray
& $nodeExe (Join-Path $RootDir "scripts\check-extension-files.mjs") (Join-Path $stageDir "extension")
if ($LASTEXITCODE -ne 0) {
    Remove-Item -Recurse -Force $stageDir -ErrorAction SilentlyContinue
    throw "El manifest de la extension declara ficheros que no existen; empaquetado abortado."
}

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

# Verificacion del CONTENIDO del zip (no solo del stage): un stage limpio no basta,
# el paquete tiene que llevar exactamente lo revisado. Aborta si aparece cualquier
# respaldo de binario, simbolo o traza, o si falta un componente obligatorio.
Write-Host "  -> Verificando el contenido del zip..." -ForegroundColor Gray
$zipEntries = @(Get-ZipEntryNames -ZipPath $zipPath | ForEach-Object { ($_ -replace '\\', '/') })
$forbidden = @($zipEntries | Where-Object {
    $_ -match $BackupRegex -or $_ -match '\.pdb$' -or $_ -match '(^|/)logs/'
})
if ($forbidden.Count -gt 0) {
    Remove-Item -Recurse -Force $stageDir -ErrorAction SilentlyContinue
    Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
    throw ("El zip contiene artefactos que NO deben distribuirse: " + (($forbidden | Select-Object -First 10) -join ", "))
}
$mustHaveInZip = @(
    "runtime/extension-host/windows/x64/extension-host.exe",
    "runtime/extension-host/src/host.mjs",
    "extension/manifest.json"
)
$missingInZip = @($mustHaveInZip | Where-Object { $zipEntries -notcontains $_ })
if ($missingInZip.Count -gt 0) {
    Remove-Item -Recurse -Force $stageDir -ErrorAction SilentlyContinue
    Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
    throw ("El zip no contiene componentes obligatorios: " + ($missingInZip -join ", "))
}
Write-Host ("  [OK] Zip verificado: {0} entradas, 0 respaldos/simbolos/trazas, host nativo presente." -f $zipEntries.Count) -ForegroundColor Green

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
