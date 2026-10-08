param(
    [string]$RepoUrl = "https://github.com/VictorTrab/computerUser.git",
    [string]$InstallDir = ""
)

$ErrorActionPreference = 'Stop'

# Escritura UTF-8 sin BOM compatible con Windows PowerShell 5.1 y PowerShell 7.
function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

# --- Identidad propia de ComputerUser (independiente de Codex/OpenAI) --------
$NativeHostName = "com.victortrab.computeruser"
$ExtensionId    = "hjfjdiahpgemdghjcnjmcdkdeapgplpd"
$LegacyHostName = "com.openai.codexextension"
$SkillNames     = @("free-computer-user", "free-control-browser")
$LegacySkills   = @("free-control-chrome", "free-control-brave", "free-control-edge")

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "      FREE COMPUTER USER - INSTALADOR UNIVERSAL           " -ForegroundColor Yellow
Write-Host "   Windows Desktop Automation & Browser Bridge via MCP    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# $PSScriptRoot llega VACIO cuando el script se ejecuta con `irm ... | iex`,
# asi que nunca se usa directamente: se normaliza aqui.
$ScriptRoot = if ($PSScriptRoot) { $PSScriptRoot } elseif ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { $null }
$RepoRawBase = "https://raw.githubusercontent.com/VictorTrab/computerUser/master"

# 1. Determinar directorio de instalacion
if (-not $InstallDir) {
    if ($ScriptRoot -and (Test-Path (Join-Path $ScriptRoot "..\runtime"))) {
        $InstallDir = (Resolve-Path (Join-Path $ScriptRoot "..")).Path
    } else {
        $InstallDir = Join-Path $env:USERPROFILE ".free-computer-user"
    }
}

Write-Host "[1/7] Preparando directorio en: $InstallDir" -ForegroundColor Gray

if (-not (Test-Path "$InstallDir\runtime\bin\node_repl.exe")) {
    $releaseZipUrl = "https://github.com/VictorTrab/computerUser/releases/latest/download/free-computer-user-windows-x64.zip"
    $tempZip = Join-Path $env:TEMP "free-computer-user-windows-x64.zip"
    $downloadSuccess = $false

    Write-Host "Descargando paquete optimizado desde GitHub Releases..." -ForegroundColor Cyan
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $releaseZipUrl -OutFile $tempZip -UseBasicParsing -ErrorAction Stop
        if ((Test-Path $tempZip) -and (Get-Item $tempZip).Length -gt 1000000) {
            Write-Host "Extrayendo componentes en $InstallDir..." -ForegroundColor Cyan
            Expand-Archive -Path $tempZip -DestinationPath $InstallDir -Force
            Remove-Item -Force $tempZip -ErrorAction SilentlyContinue
            $downloadSuccess = $true
            Write-Host "  [OK] Release instalado correctamente (sin necesidad de Git)." -ForegroundColor Green
        }
    } catch {
        Write-Host "  (Aviso: Release no disponible aun, descargando via Git...)" -ForegroundColor DarkYellow
    }

    if (-not $downloadSuccess) {
        if (Get-Command git -ErrorAction SilentlyContinue) {
            Write-Host "Clonando repositorio desde $RepoUrl..." -ForegroundColor Cyan
            git clone $RepoUrl $InstallDir
        } else {
            throw "No se pudo descargar el release oficial y Git no esta instalado en este equipo."
        }
    }
}

# 2. Normalizar rutas locales en archivos JSON de configuracion
Write-Host "[2/7] Configurando rutas absolutas para este usuario..." -ForegroundColor Gray

# Guardian del host nativo: el paquete DEBE traer NUESTRO lanzador, no el binario
# de Codex. Si el paquete viniera con el de Codex, avisamos en vez de instalar un
# host ajeno en silencio. (Revertir siempre es posible: extension-host.exe.bak-codex)
$extHostExeRaw = Join-Path $InstallDir "runtime\extension-host\windows\x64\extension-host.exe"
$extHostSrcRaw = Join-Path $InstallDir "runtime\extension-host\src\host.mjs"
$ownHostOk = $false
if ((Test-Path $extHostExeRaw) -and (Test-Path $extHostSrcRaw)) {
    $probeNode = Join-Path $InstallDir "runtime\bin\node.exe"
    if (Test-Path $probeNode) {
        try {
            $probe = [string](& $probeNode -e "const fs=require('fs');const b=fs.readFileSync(process.argv[1]);const m=Buffer.from('ComputerUser native messaging launcher','latin1');process.stdout.write(b.includes(m)?'OWN':'FOREIGN')" $extHostExeRaw 2>$null)
            $ownHostOk = ($probe -match 'OWN')
        } catch { $ownHostOk = $false }
    }
}
if ($ownHostOk) {
    Write-Host "  [OK] Host nativo propio presente (lanzador + src\host.mjs)." -ForegroundColor Green
} else {
    Write-Host "  [AVISO] runtime\extension-host\windows\x64\extension-host.exe no es nuestro lanzador" -ForegroundColor DarkYellow
    Write-Host "          (o falta src\host.mjs). El puente de navegador no funcionara." -ForegroundColor DarkYellow
    Write-Host "          Reinstala desde el release oficial o compila con runtime\extension-host\launcher\build.ps1" -ForegroundColor DarkYellow
}

$binDir = Join-Path $InstallDir "runtime\bin"
$browserDir = Join-Path $InstallDir "runtime\browser"
$homeDir = Join-Path $InstallDir "home"
$extHostDir = Join-Path $InstallDir "runtime\extension-host"

# Shim `browser`: el kernel de node_repl solo permite que un paquete importe
# archivos dentro de un node_modules configurado, asi que browser-client.mjs se
# mantiene copiado dentro del paquete en cada instalacion/actualizacion.
$shimDir = Join-Path $binDir "node_modules\browser"
New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
Copy-Item -Path (Join-Path $browserDir "browser-client.mjs") -Destination (Join-Path $shimDir "browser-client.mjs") -Force
Write-Host "  -> Shim 'browser' sincronizado con el cliente actual." -ForegroundColor DarkGray

# Shim `@computer-user/sky-guard`: la guardia de allowlist/lista negra que
# envuelve al servicio confiable `sky`. La fuente unica es
# runtime\computer-use\sky-guard.mjs y aqui se copia igual que browser-client.mjs:
# el kernel de node_repl solo importa ficheros dentro de NODE_REPL_TRUSTED_CODE_PATHS
# y resuelve el especificador "@computer-user/sky-guard" via NODE_REPL_NODE_MODULE_DIRS.
$guardSource = Join-Path $InstallDir "runtime\computer-use\sky-guard.mjs"
if (-not (Test-Path $guardSource)) { throw "Falta la guardia de Computer Use: $guardSource" }
$guardShimDir = Join-Path $binDir "node_modules\@computer-user\sky-guard"
New-Item -ItemType Directory -Path $guardShimDir -Force | Out-Null
Copy-Item -Path $guardSource -Destination (Join-Path $guardShimDir "index.mjs") -Force
$guardPackageJson = [ordered]@{
    name = "@computer-user/sky-guard"
    version = "1.0.0"
    private = $true
    description = "Allowlist/blacklist guard that wraps the @oai/sky trusted RPC service for the node_repl kernel"
    type = "module"
    main = "index.mjs"
    exports = @{ "." = "./index.mjs" }
}
Write-Utf8NoBom (Join-Path $guardShimDir "package.json") ($guardPackageJson | ConvertTo-Json -Depth 5)
Write-Host "  -> Shim '@computer-user/sky-guard' sincronizado con la guardia actual." -ForegroundColor DarkGray

# Limpiar residuos de versiones anteriores / estado del runtime en el home propio
foreach ($junk in @("skills", "tmp", ".tmp", "installation_id")) {
    $junkPath = Join-Path $homeDir $junk
    if (Test-Path $junkPath) { Remove-Item -Recurse -Force $junkPath -ErrorAction SilentlyContinue }
}

# Actualizar manifest del Native Messaging Host (nombre propio, sin colisiones)
$hostManifest = Join-Path $extHostDir "$NativeHostName.json"
Remove-Item -Force (Join-Path $extHostDir "$LegacyHostName.json") -ErrorAction SilentlyContinue
$extHostExe = Join-Path $extHostDir "windows\x64\extension-host.exe"

$hostJson = [ordered]@{
    name = $NativeHostName
    description = "ComputerUser browser native messaging host"
    type = "stdio"
    path = $extHostExe
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
Write-Utf8NoBom $hostManifest ($hostJson | ConvertTo-Json -Depth 5)
Write-Host "  -> Native Host manifest actualizado ($NativeHostName)." -ForegroundColor DarkGray

# Configurar hook dinamico en home/config.toml
$notifyExe = (Join-Path $InstallDir "runtime\bin\node_modules\@oai\sky\bin\windows\codex-computer-use.exe")
$configTomlContent = "notify = ['$($notifyExe.Replace('\', '\\'))', `"turn-ended`"]`n"
Write-Utf8NoBom (Join-Path $homeDir "config.toml") $configTomlContent

# Actualizar mcp_config.json del proyecto
$mcpConfigFile = Join-Path $InstallDir "mcp_config.json"
$nodeReplExe = (Join-Path $binDir "node_repl.exe")
$nodeExe = (Join-Path $binDir "node.exe")
$nodeModules = (Join-Path $binDir "node_modules")
$browserServicePosix = (Join-Path $browserDir "browser-service.mjs").Replace("\", "/")

# `sky` apunta a NUESTRA guardia, no al servicio crudo de @oai/sky: sin esto el
# modo independiente no aplica la allowlist ni las prohibiciones. Si el shim no
# puede cargarse, el kernel falla de forma visible en lugar de degradar.
$skyGuardPackage = "@computer-user/sky-guard"
$trustedServices = '{"browser":"' + $browserServicePosix + '","sky":"' + $skyGuardPackage + '"}'

$runtimeEnv = [ordered]@{
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
    # Clave de la independencia: sin red ambiental no se pide identidad/token de
    # OpenAI ni se envian datos de telemetria fuera del equipo.
    BROWSER_USE_DISABLE_AMBIENT_NETWORK = "1"
    BROWSER_USE_CODEX_APP_BUILD_FLAVOR = "prod"
    BROWSER_USE_CODEX_APP_VERSION = "26.915.31945"
}

$mcpConfig = @{
    mcpServers = @{
        "computer-user" = @{
            command = $nodeReplExe
            args = @("--disable-sandbox")
            env = $runtimeEnv
        }
    }
}
Write-Utf8NoBom $mcpConfigFile ($mcpConfig | ConvertTo-Json -Depth 6)
Write-Host "  -> mcp_config.json local actualizado." -ForegroundColor DarkGray

# 3. Registrar Native Messaging Host en Windows Registry (Chrome, Brave, Edge)
Write-Host "[3/7] Registrando Native Messaging Host en navegadores..." -ForegroundColor Gray
$browserRegRoots = @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts",
    "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts"
)

foreach ($root in $browserRegRoots) {
    if (-not (Test-Path $root)) {
        New-Item -Path $root -ItemType Directory -Force | Out-Null
    }

    # Limpiar el nombre heredado SOLO si apunta a nuestra propia instalacion,
    # para no tocar nunca el native host de la app Codex.
    $legacyKey = Join-Path $root $LegacyHostName
    if (Test-Path $legacyKey) {
        $legacyValue = (Get-ItemProperty -Path $legacyKey -ErrorAction SilentlyContinue).'(default)'
        if ($legacyValue -and ($legacyValue -like "$InstallDir*")) {
            Remove-Item -Path $legacyKey -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "  [OK] Entrada heredada eliminada: $legacyKey" -ForegroundColor DarkGray
        }
    }

    $regKey = Join-Path $root $NativeHostName
    New-Item -Path $regKey -Force | Out-Null
    Set-ItemProperty -Path $regKey -Name "(default)" -Value $hostManifest
    Write-Host "  [OK] $regKey" -ForegroundColor Green
}

# 4. Instalar Skills Globales en ~/.agents
Write-Host "[4/7] Desplegando skills globales en ~/.agents\skills..." -ForegroundColor Gray

$globalSkillsDir = Join-Path $env:USERPROFILE ".agents\skills"
if (-not (Test-Path $globalSkillsDir)) {
    New-Item -ItemType Directory -Path $globalSkillsDir -Force | Out-Null
}

# Retirar skills duplicadas de versiones anteriores
foreach ($old in $LegacySkills) {
    $oldDir = Join-Path $globalSkillsDir $old
    if (Test-Path $oldDir) {
        Remove-Item -Recurse -Force $oldDir -ErrorAction SilentlyContinue
        Write-Host "  [OK] Skill duplicada eliminada: $old" -ForegroundColor DarkGray
    }
}

foreach ($sName in $SkillNames) {
    $destDir = Join-Path $globalSkillsDir $sName
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    $destFile = Join-Path $destDir "SKILL.md"

    # Buscar origen local (ej. repositorio clonado); con `iex` no hay origen local
    $localSkill = if ($ScriptRoot) { Join-Path $ScriptRoot "..\skills\$sName\SKILL.md" } else { $null }
    if ($localSkill -and (Test-Path $localSkill)) {
        Copy-Item -Path $localSkill -Destination $destFile -Force
    } else {
        # Descarga directa a ~/.agents\skills (sin tocar el directorio del motor)
        $rawUrl = "$RepoRawBase/skills/$sName/SKILL.md"
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $rawUrl -OutFile $destFile -UseBasicParsing -ErrorAction Stop
        } catch {
            Write-Host "  (Aviso: No se pudo descargar la skill $sName desde GitHub: $_)" -ForegroundColor DarkYellow
        }
    }
}

Write-Host "  [OK] Skills disponibles universalmente en ~/.agents\skills (escritorio y navegador)." -ForegroundColor Green

# 5. Configurar DeepSeek Harness si existe (upsert del bloque completo)
Write-Host "[5/7] Verificando integracion con DeepSeek Harness (dsh)..." -ForegroundColor Gray
$cordisPatch = Join-Path $env:USERPROFILE ".dsh\profiles\desktop\cordis.patch.yml"
if (Test-Path $cordisPatch) {
    $envYaml = ($runtimeEnv.GetEnumerator() | ForEach-Object {
        "      {0}: '{1}'" -f $_.Key, ($_.Value -replace "'", "''")
    }) -join "`n"

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
$envYaml
"@

    $content = Get-Content $cordisPatch -Raw
    if ($content -match '(?ms)^- id: mcp-computer-user\s*$') {
        $updated = [regex]::Replace($content, '(?ms)^- id: mcp-computer-user.*?(?=^- id: |\z)', ($mcpBlock + "`n`n"))
        Write-Utf8NoBom $cordisPatch $updated
        Write-Host "  [OK] Bloque mcp-computer-user actualizado en cordis.patch.yml." -ForegroundColor Green
    } else {
        Write-Utf8NoBom $cordisPatch ($content + "`n" + $mcpBlock)
        Write-Host "  [OK] DeepSeek Harness configurado exitosamente." -ForegroundColor Green
    }
} else {
    Write-Host "  (DeepSeek Harness no detectado, se omite)." -ForegroundColor DarkGray
}

# 6. Configurar Antigravity
Write-Host "[6/7] Verificando integracion con Antigravity..." -ForegroundColor Gray
$antigravityMcpConfig = Join-Path $env:USERPROFILE ".gemini\antigravity\mcp_config.json"
if (Test-Path (Split-Path $antigravityMcpConfig)) {
    try {
        if (Test-Path $antigravityMcpConfig) {
            $existing = Get-Content $antigravityMcpConfig -Raw | ConvertFrom-Json
        } else {
            $existing = [pscustomobject]@{ mcpServers = [pscustomobject]@{} }
        }
        $existing.mcpServers | Add-Member -MemberType NoteProperty -Name "computer-user" -Value $mcpConfig.mcpServers."computer-user" -Force
        Write-Utf8NoBom $antigravityMcpConfig ($existing | ConvertTo-Json -Depth 6)
        Write-Host "  [OK] computer-user registrado en Antigravity." -ForegroundColor Green
    } catch {
        Write-Host "  (Nota: Revisa ~/.gemini/antigravity/mcp_config.json para agregar computer-user manualmente si es necesario)." -ForegroundColor DarkYellow
    }
}

# 7. Registrar CLI en el PATH del Usuario
Write-Host "[7/7] Registrando comando 'free-computer-user' en PATH de Windows..." -ForegroundColor Gray
$cliBinDir = Join-Path $InstallDir "bin"
$currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentUserPath -split ';' -notcontains $cliBinDir) {
    [Environment]::SetEnvironmentVariable("Path", "$currentUserPath;$cliBinDir", "User")
    $env:Path = "$env:Path;$cliBinDir"
    Write-Host "  [OK] PATH actualizado. Ya puedes ejecutar 'free-computer-user' desde cualquier terminal." -ForegroundColor Green
} else {
    Write-Host "  [OK] 'free-computer-user' ya esta en el PATH del sistema." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "         INSTALACION COMPLETADA CON EXITO                 " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Comandos disponibles en cualquier terminal:" -ForegroundColor Cyan
Write-Host "  free-computer-user doctor      (Verifica estado de salud)" -ForegroundColor White
Write-Host "  free-computer-user update      (Actualiza a la ultima version)" -ForegroundColor White
Write-Host "  free-computer-user uninstall   (Desinstala limpiamente)" -ForegroundColor White
Write-Host ""
Write-Host "Carga la extension (una vez por navegador) si aun no lo has hecho:" -ForegroundColor Yellow
Write-Host "  1. Entra a chrome://extensions, brave://extensions o edge://extensions"
Write-Host "  2. Activa 'Modo Desarrollador'."
Write-Host "  3. 'Cargar descomprimida' -> $InstallDir\extension"
Write-Host "     (ID esperado: $ExtensionId)"
Write-Host ""

# Ejecutar doctor al finalizar
& (Join-Path $InstallDir "scripts\doctor.ps1")
