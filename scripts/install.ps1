param(
    [string]$RepoUrl = "https://github.com/VictorTrab/computerUser.git",
    [string]$InstallDir = ""
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "      COMPUTERUSER - INSTALADOR UNIVERSAL DE PLUGIN       " -ForegroundColor Yellow
Write-Host "   Windows Computer Use & Chrome Controller via MCP/Stdio " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Determinar directorio de instalacion
if (-not $InstallDir) {
    if (Test-Path "$PSScriptRoot\..\runtime") {
        $InstallDir = (Resolve-Path "$PSScriptRoot\..").Path
    } else {
        $InstallDir = Join-Path $env:USERPROFILE ".agents\computerUser"
    }
}

Write-Host "[1/6] Preparando directorio en: $InstallDir" -ForegroundColor Gray

if (-not (Test-Path "$InstallDir\runtime\bin\node_repl.exe")) {
    if (Get-Command git -ErrorAction SilentlyContinue) {
        Write-Host "Clonando repositorio desde $RepoUrl..." -ForegroundColor Cyan
        git clone $RepoUrl $InstallDir
    } else {
        throw "Git no esta instalado en este equipo. Por favor instala Git o copia la carpeta manualmente."
    }
}

# 2. Normalizar rutas locales en archivos JSON de configuracion
Write-Host "[2/6] Configurando rutas absolutas para este usuario..." -ForegroundColor Gray

$binDir = Join-Path $InstallDir "runtime\bin"
$browserDir = Join-Path $InstallDir "runtime\browser"
$homeDir = Join-Path $InstallDir "home"
$extHostDir = Join-Path $InstallDir "runtime\extension-host"

# Actualizar manifest del Native Messaging Host
$hostManifest = Join-Path $extHostDir "com.openai.codexextension.json"
$extHostExe = (Join-Path $extHostDir "windows\x64\extension-host.exe").Replace("\", "\\")

$hostJson = @{
    name = "com.openai.codexextension"
    description = "ComputerUser browser native messaging host"
    type = "stdio"
    path = $extHostExe
    allowed_origins = @(
        "chrome-extension://hehggadaopoacecdllhhajmbjkdcmajg/",
        "chrome-extension://odlomjlbamekndcpllcnffbgeohgkmjh/"
    )
}
$hostJson | ConvertTo-Json -Depth 5 | Set-Content $hostManifest -Encoding UTF8
Write-Host "  -> Native Host manifest actualizado." -ForegroundColor DarkGray

# Actualizar mcp_config.json del proyecto
$mcpConfigFile = Join-Path $InstallDir "mcp_config.json"
$nodeReplExe = (Join-Path $binDir "node_repl.exe")
$nodeExe = (Join-Path $binDir "node.exe")
$nodeModules = (Join-Path $binDir "node_modules")
$browserServicePosix = (Join-Path $browserDir "browser-service.mjs").Replace("\", "/")

$trustedServices = '{"browser":"' + $browserServicePosix + '","sky":"@oai/sky/service"}'

$mcpConfig = @{
    mcpServers = @{
        "computer-user" = @{
            command = $nodeReplExe
            args = @("--disable-sandbox")
            env = @{
                CODEX_HOME = $homeDir
                NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS = "1000"
                NODE_REPL_NODE_MODULE_DIRS = $nodeModules
                NODE_REPL_NODE_PATH = $nodeExe
                NODE_REPL_TRUSTED_CODE_PATHS = "$homeDir;$nodeModules;$browserDir"
                NODE_REPL_TRUSTED_SERVICES = $trustedServices
                SKY_CUA_NATIVE_PIPE = "0"
                SKY_CUA_NATIVE_PIPE_DIRECTORY = "\\.\pipe\codex-computer-use-149f0122-3721-4a5a-883d-38d414b0ec25"
                BROWSER_USE_AVAILABLE_BACKENDS = "chrome,iab"
                BROWSER_USE_TINYSKY_ENABLED = "1"
                BROWSER_USE_SECURITY_MODE = "disabled-for-local-testing"
                BROWSER_USE_FULL_CDP_ACCESS_ENABLED = "1"
                BROWSER_USE_CODEX_APP_BUILD_FLAVOR = "prod"
                BROWSER_USE_CODEX_APP_VERSION = "26.915.31945"
            }
        }
    }
}
$mcpConfig | ConvertTo-Json -Depth 6 | Set-Content $mcpConfigFile -Encoding UTF8
Write-Host "  -> mcp_config.json local actualizado." -ForegroundColor DarkGray

# 3. Registrar Native Messaging Host en Windows Registry (Chrome, Brave, Edge)
Write-Host "[3/6] Registrando Native Messaging Host en navegadores..." -ForegroundColor Gray
$regTargets = @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.openai.codexextension",
    "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.openai.codexextension",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.openai.codexextension"
)

foreach ($r in $regTargets) {
    $parent = Split-Path $r
    if (-not (Test-Path $parent)) {
        New-Item -Path $parent -ItemType Directory -Force | Out-Null
    }
    New-Item -Path $r -Force | Out-Null
    Set-ItemProperty -Path $r -Name "(default)" -Value $hostManifest
    Write-Host "  [OK] $r" -ForegroundColor Green
}

# 4. Instalar Skills Globales en ~/.agents y ~/.dsh
Write-Host "[4/6] Desplegando skills globales en ~/.agents/skills y ~/.dsh/skills..." -ForegroundColor Gray

$globalSkillsDir = Join-Path $env:USERPROFILE ".agents\skills"
$dshSkillsDir = Join-Path $env:USERPROFILE ".dsh\skills"

foreach ($targetDir in @($globalSkillsDir, $dshSkillsDir)) {
    $cuDir = Join-Path $targetDir "computer-use-windows"
    $chromeDir = Join-Path $targetDir "control-chrome"
    New-Item -ItemType Directory -Path $cuDir -Force | Out-Null
    New-Item -ItemType Directory -Path $chromeDir -Force | Out-Null
    
    Copy-Item (Join-Path $InstallDir "skills\computer-use-windows\SKILL.md") (Join-Path $cuDir "SKILL.md") -Force
    Copy-Item (Join-Path $InstallDir "skills\control-chrome\SKILL.md") (Join-Path $chromeDir "SKILL.md") -Force
}
Write-Host "  [OK] Skills disponibles para Cursor, Cline, OpenCode, Codex y DeepSeek." -ForegroundColor Green

# 5. Configurar DeepSeek Harness si existe
Write-Host "[5/6] Verificando integracion con DeepSeek Harness (dsh)..." -ForegroundColor Gray
$cordisPatch = Join-Path $env:USERPROFILE ".dsh\profiles\desktop\cordis.patch.yml"
if (Test-Path $cordisPatch) {
    $content = Get-Content $cordisPatch -Raw
    if ($content -notmatch "mcp-computer-user") {
        Write-Host "  -> Registrando plugin en cordis.patch.yml..." -ForegroundColor Cyan
        $mcpBlock = @"

- id: mcp-computer-user
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: computer_user
    transport: stdio
    command: '$nodeReplExe'
    args:
      - "--disable-sandbox"
    env:
      CODEX_HOME: '$homeDir'
      NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS: "1000"
      NODE_REPL_NODE_MODULE_DIRS: '$nodeModules'
      NODE_REPL_NODE_PATH: '$nodeExe'
      NODE_REPL_TRUSTED_CODE_PATHS: '$homeDir;$nodeModules;$browserDir'
      NODE_REPL_TRUSTED_SERVICES: '$trustedServices'
      SKY_CUA_NATIVE_PIPE: "0"
      SKY_CUA_NATIVE_PIPE_DIRECTORY: '\\.\pipe\codex-computer-use-149f0122-3721-4a5a-883d-38d414b0ec25'
      BROWSER_USE_AVAILABLE_BACKENDS: "chrome,iab"
      BROWSER_USE_TINYSKY_ENABLED: "1"
      BROWSER_USE_SECURITY_MODE: "disabled-for-local-testing"
      BROWSER_USE_FULL_CDP_ACCESS_ENABLED: "1"
      BROWSER_USE_CODEX_APP_BUILD_FLAVOR: "prod"
      BROWSER_USE_CODEX_APP_VERSION: "26.915.31945"
"@
        Add-Content -Path $cordisPatch -Value $mcpBlock -Encoding UTF8
        Write-Host "  [OK] DeepSeek Harness configurado exitosamente." -ForegroundColor Green
    } else {
        Write-Host "  [OK] Ya estaba configurado en DeepSeek Harness." -ForegroundColor DarkGray
    }
} else {
    Write-Host "  (DeepSeek Harness no detectado, se omite)." -ForegroundColor DarkGray
}

# 6. Configurar Antigravity
Write-Host "[6/6] Verificando integracion con Antigravity..." -ForegroundColor Gray
$antigravityMcpConfig = Join-Path $env:USERPROFILE ".gemini\antigravity\mcp_config.json"
if (Test-Path (Split-Path $antigravityMcpConfig)) {
    if (Test-Path $antigravityMcpConfig) {
        try {
            $existing = Get-Content $antigravityMcpConfig -Raw | ConvertFrom-Json
            if (-not $existing.mcpServers."computer-user") {
                $existing.mcpServers | Add-Member -MemberType NoteProperty -Name "computer-user" -Value $mcpConfig.mcpServers."computer-user"
                $existing | ConvertTo-Json -Depth 6 | Set-Content $antigravityMcpConfig -Encoding UTF8
                Write-Host "  [OK] Añadido al mcp_config.json de Antigravity." -ForegroundColor Green
            }
        } catch {
            Write-Host "  (Nota: Revisa ~/.gemini/antigravity/mcp_config.json para agregar computer-user manualmente si es necesario)." -ForegroundColor DarkYellow
        }
    } else {
        $mcpConfig | ConvertTo-Json -Depth 6 | Set-Content $antigravityMcpConfig -Encoding UTF8
        Write-Host "  [OK] Creado ~/.gemini/antigravity/mcp_config.json." -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "         INSTALACION COMPLETADA CON EXITO                 " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Pasos finales para tus navegadores (Chrome o Brave):" -ForegroundColor Cyan
Write-Host "1. Abre chrome://extensions o brave://extensions"
Write-Host "2. Activa el 'Modo Desarrollador' (arriba a la derecha)."
Write-Host "3. Haz clic en 'Cargar descomprimida' y selecciona:"
Write-Host "   $InstallDir\extension" -ForegroundColor Yellow
Write-Host "4. En 'Detalles', activa 'Permitir acceso a URLs de archivo'."
Write-Host ""
Write-Host "Listo. Tus agentes ya pueden automatizar el escritorio y el navegador." -ForegroundColor Green
