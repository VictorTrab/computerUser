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
}

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
    "skills\free-control-chrome\SKILL.md",
    "rules\AGENTS.md",
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
    "runtime\extension-host\com.openai.codexextension.json",
    "mcp_config.json"
)
foreach ($jf in $jsonFiles) {
    $content = Get-Content (Join-Path $RootDir $jf) -Raw
    $null = $content | ConvertFrom-Json
}
Write-Host "  [OK] Archivos JSON validos y sin errores de sintaxis." -ForegroundColor Green

# C. Validar handshake MCP de node_repl.exe
Write-Host "  -> Probando arranque y handshake MCP de node_repl.exe..." -ForegroundColor Gray
$nodeReplExe = Join-Path $RootDir "runtime\bin\node_repl.exe"
$handshakeJson = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"ci-smoke-test","version":"1.0.0"}}}'

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $nodeReplExe
$psi.Arguments = "--disable-sandbox"
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)
$proc.StandardInput.WriteLine($handshakeJson)
$proc.StandardInput.Flush()

$response = ""
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.ElapsedMilliseconds -lt 6000 -and (-not $proc.HasExited)) {
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
    throw "Fallo en el smoke test de node_repl.exe: No respondio al handshake MCP."
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
Get-ChildItem -Path $stageDir -Recurse -Include "*.sqlite*", "*.wal", "*.shm", "*.tmp" | Remove-Item -Force -ErrorAction SilentlyContinue

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
