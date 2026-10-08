# Diagnóstico de salud para Free Computer User
$InstallDir = (Resolve-Path "$PSScriptRoot\..").Path

# Identidad propia de ComputerUser (independiente de Codex/OpenAI)
$NativeHostName = "com.victortrab.computeruser"
$LegacyHostName = "com.openai.codexextension"
$ExpectedExtensionId = "hjfjdiahpgemdghjcnjmcdkdeapgplpd"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "        FREE COMPUTER USER - DIAGNOSTICO DE SALUD         " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$script:allOk = $true

function Report-Check {
    param(
        [string]$Name,
        [bool]$Status,
        [string]$SuccessMsg,
        [string]$ErrorMsg,
        [string]$FixMsg = ""
    )
    if ($Status) {
        Write-Host "  [OK] $Name - $SuccessMsg" -ForegroundColor Green
    } else {
        $script:allOk = $false
        Write-Host "  [FAIL] $Name - $ErrorMsg" -ForegroundColor Red
        if ($FixMsg) {
            Write-Host "         -> Solucion: $FixMsg" -ForegroundColor Yellow
        }
    }
}

# 1. Runtimes
Write-Host "[1/6] Verificando Runtimes Locales..." -ForegroundColor Cyan
$nodeReplPath = Join-Path $InstallDir "runtime\bin\node_repl.exe"
$nodePath = Join-Path $InstallDir "runtime\bin\node.exe"
$extHostPath = Join-Path $InstallDir "runtime\extension-host\windows\x64\extension-host.exe"

Report-Check -Name "node_repl.exe" -Status (Test-Path $nodeReplPath) `
    -SuccessMsg "Presente en runtime\bin" `
    -ErrorMsg "Falta node_repl.exe" `
    -FixMsg "Ejecuta 'free-computer-user update' o reinstala con install.ps1"

Report-Check -Name "node.exe" -Status (Test-Path $nodePath) `
    -SuccessMsg "Presente en runtime\bin" `
    -ErrorMsg "Falta node.exe"

Report-Check -Name "extension-host.exe" -Status (Test-Path $extHostPath) `
    -SuccessMsg "Presente en runtime\extension-host" `
    -ErrorMsg "Falta extension-host.exe"

$hasPython = [bool](Get-Command python -ErrorAction SilentlyContinue)
Report-Check -Name "Python Runtime" -Status $hasPython `
    -SuccessMsg "Python detectado en el PATH del sistema" `
    -ErrorMsg "Python no encontrado en el sistema" `
    -FixMsg "Instala Python desde python.org si deseas ejecutar scripts adaptadores"

# Shim `browser`: permite `await import("browser")` desde cualquier skill
$shimIndex = Join-Path $InstallDir "runtime\bin\node_modules\browser\index.mjs"
$shimClient = Join-Path $InstallDir "runtime\bin\node_modules\browser\browser-client.mjs"
$shimOk = (Test-Path $shimIndex) -and (Test-Path $shimClient)
if ($shimOk) {
    $shimOk = (Get-FileHash $shimClient).Hash -eq (Get-FileHash (Join-Path $InstallDir "runtime\browser\browser-client.mjs")).Hash
}
Report-Check -Name "Shim 'browser'" -Status $shimOk `
    -SuccessMsg "import('browser') disponible y sincronizado" `
    -ErrorMsg "Falta el shim o esta desincronizado con runtime\browser" `
    -FixMsg "Ejecuta 'free-computer-user update' para regenerarlo"

# 2. Native Messaging Host en Registro de Windows
Write-Host ""
Write-Host "[2/6] Verificando Registro de Windows (Native Messaging Host)..." -ForegroundColor Cyan
$regKeys = @(
    @{ Browser = "Google Chrome"; Path = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$NativeHostName" },
    @{ Browser = "Brave Browser"; Path = "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$NativeHostName" },
    @{ Browser = "Microsoft Edge"; Path = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$NativeHostName" }
)

foreach ($r in $regKeys) {
    $exists = Test-Path $r.Path
    $targetFile = ""
    if ($exists) {
        $targetFile = (Get-ItemProperty -Path $r.Path -Name "(default)" -ErrorAction SilentlyContinue)."(default)"
    }
    $validTarget = ($exists -and (Test-Path $targetFile))
    Report-Check -Name $r.Browser -Status $validTarget `
        -SuccessMsg "Registrado correctamente" `
        -ErrorMsg "No registrado o ruta invalida" `
        -FixMsg "Ejecuta 'free-computer-user update' para regenerar las claves del registro"
}

# 3. Extensión de Navegador
Write-Host ""
Write-Host "[3/6] Verificando Extension de Navegador..." -ForegroundColor Cyan
$extensionDir = Join-Path $InstallDir "extension"
$manifestPath = Join-Path $extensionDir "manifest.json"
$extExists = Test-Path $manifestPath
Report-Check -Name "Manifest V3" -Status $extExists `
    -SuccessMsg "Manifiesto y assets presentes" `
    -ErrorMsg "No se encuentra extension\manifest.json"

# El ID de la extension se deriva de la clave publica del manifiesto; debe
# coincidir con allowed_origins del native host o el navegador no conectara.
if ($extExists) {
    try {
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
        $der = [Convert]::FromBase64String($manifest.key)
        $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($der)
        $derivedId = ""
        foreach ($b in $hash[0..15]) {
            $derivedId += [char](97 + [int]($b -shr 4)) + [char](97 + [int]($b -band 15))
        }
        $hostManifestPath = Join-Path $InstallDir "runtime\extension-host\$NativeHostName.json"
        $originsOk = $false
        if (Test-Path $hostManifestPath) {
            $originsOk = (Get-Content $hostManifestPath -Raw) -match "chrome-extension://$derivedId/"
        }
        Report-Check -Name "ID de extension" -Status $originsOk `
            -SuccessMsg "ID $derivedId coincide con el native host" `
            -ErrorMsg "ID $derivedId no coincide con allowed_origins de $NativeHostName.json" `
            -FixMsg "Ejecuta 'free-computer-user update' para regenerar el native host manifest"
    } catch {
        Report-Check -Name "ID de extension" -Status $false `
            -ErrorMsg "No se pudo derivar el ID desde extension\manifest.json" `
            -FixMsg "Revisa que el manifiesto incluya el campo 'key'"
    }
}

Write-Host "      -> Carga descomprimida (una vez por navegador): $extensionDir" -ForegroundColor DarkGray
Write-Host "         chrome://extensions | brave://extensions | edge://extensions" -ForegroundColor DarkGray

# 4. Skills Globales en ~/.agents
Write-Host ""
Write-Host "[4/6] Verificando Skills de Agentes..." -ForegroundColor Cyan
$globalSkills = Join-Path $env:USERPROFILE ".agents\skills"

$gCu = Test-Path (Join-Path $globalSkills "free-computer-user\SKILL.md")
$gBrowser = Test-Path (Join-Path $globalSkills "free-control-browser\SKILL.md")
$allSkillsOk = ($gCu -and $gBrowser)

Report-Check -Name "Skills Globales (~/.agents)" -Status $allSkillsOk `
    -SuccessMsg "free-computer-user y free-control-browser instaladas" `
    -ErrorMsg "Faltan skills en ~/.agents\skills" `
    -FixMsg "Ejecuta 'free-computer-user update' para desplegarlas"

$duplicated = @("free-control-chrome", "free-control-brave", "free-control-edge") |
    Where-Object { Test-Path (Join-Path $globalSkills "$_\SKILL.md") }
Report-Check -Name "Sin skills duplicadas" -Status ($duplicated.Count -eq 0) `
    -SuccessMsg "Solo hay una skill de navegador" `
    -ErrorMsg ("Skills duplicadas presentes: " + ($duplicated -join ", ")) `
    -FixMsg "Ejecuta 'free-computer-user update' para consolidarlas en free-control-browser"

# 5. Configuración de Seguridad y Allowlist
Write-Host ""
Write-Host "[5/6] Verificando Allowlist de Seguridad..." -ForegroundColor Cyan
$allowlistPath = Join-Path $InstallDir "home\computer-use\config.toml"
$allowlistOk = (Test-Path $allowlistPath)
$appsCount = 0
if ($allowlistOk) {
    $content = Get-Content $allowlistPath -Raw
    $appsCount = ([regex]::Matches($content, '"([^"]+\.exe|[^"]+!App)"')).Count
}
Report-Check -Name "config.toml Allowlist" -Status ($allowlistOk -and $appsCount -gt 5) `
    -SuccessMsg "Activa con $appsCount aplicaciones permitidas" `
    -ErrorMsg "Archivo config.toml ausente o vacio" `
    -FixMsg "Revisa home\computer-use\config.toml"

# 6. Integración MCP
Write-Host ""
Write-Host "[6/6] Verificando Integraciones MCP..." -ForegroundColor Cyan
$mcpConfigLocal = Join-Path $InstallDir "mcp_config.json"
$mcpExists = Test-Path $mcpConfigLocal
Report-Check -Name "mcp_config.json Local" -Status $mcpExists `
    -SuccessMsg "Archivo de servidor MCP disponible" `
    -ErrorMsg "Falta mcp_config.json"

if ($mcpExists) {
    $mcpRaw = Get-Content $mcpConfigLocal -Raw
    Report-Check -Name "Modo offline (sin token)" -Status ($mcpRaw -match "BROWSER_USE_DISABLE_AMBIENT_NETWORK") `
        -SuccessMsg "BROWSER_USE_DISABLE_AMBIENT_NETWORK activo: no requiere cuenta ni token de Codex/OpenAI" `
        -ErrorMsg "Falta BROWSER_USE_DISABLE_AMBIENT_NETWORK; el motor pedira el token de Codex" `
        -FixMsg "Ejecuta 'free-computer-user update' para regenerar mcp_config.json"
}

# El servicio de navegador se parchea para no exigir identidad en modo local.
$servicePath = Join-Path $InstallDir "runtime\browser\browser-service.mjs"
$servicePatched = (Test-Path $servicePath) -and ((Get-Content $servicePath -Raw) -match "ComputerUser patch")
Report-Check -Name "Servicio de navegador propio" -Status $servicePatched `
    -SuccessMsg "browser-service.mjs con el parche local de ComputerUser" `
    -ErrorMsg "browser-service.mjs sin el parche local (pedira identidad de Codex)" `
    -FixMsg "Ejecuta 'free-computer-user update' o reinstala desde el release oficial"

$dshCordis = Join-Path $env:USERPROFILE ".dsh\profiles\desktop\cordis.patch.yml"
if (Test-Path $dshCordis) {
    $hasDsh = (Get-Content $dshCordis -Raw) -match "mcp-computer-user"
    Report-Check -Name "DeepSeek Harness MCP" -Status $hasDsh `
        -SuccessMsg "Servidor mcp-computer-user configurado en cordis.patch.yml" `
        -ErrorMsg "No configurado en cordis.patch.yml"
}

$antigravityConfig = Join-Path $env:USERPROFILE ".gemini\antigravity\mcp_config.json"
if (Test-Path $antigravityConfig) {
    $hasAnti = (Get-Content $antigravityConfig -Raw) -match "computer-user"
    Report-Check -Name "Antigravity MCP" -Status $hasAnti `
        -SuccessMsg "Registrado en antigravity\mcp_config.json" `
        -ErrorMsg "No configurado en Antigravity"
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
if ($script:allOk) {
    Write-Host "       TODOS LOS COMPONENTES ESTAN OPERATIVOS [100%]       " -ForegroundColor Green
} else {
    Write-Host "  ALGUNOS COMPONENTES REQUIEREN ATENCION (Ver arriba)     " -ForegroundColor Yellow
}
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
