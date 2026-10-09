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

# El host nativo es PROPIO (ya no se usa el binario de Codex): lanzador compilado
# + src\host.mjs. Comprobamos las dos cosas, no solo que exista el .exe.
$hasExtHost = Test-Path $extHostPath
Report-Check -Name "extension-host.exe" -Status $hasExtHost `
    -SuccessMsg "Presente en runtime\extension-host" `
    -ErrorMsg "Falta extension-host.exe" `
    -FixMsg "Reinstala con install.ps1 o ejecuta 'free-computer-user update'"

if ($hasExtHost) {
    $hostSrc = Join-Path $InstallDir "runtime\extension-host\src\host.mjs"
    $ownHost = $false
    try {
        $probe = [string](& $nodePath -e "const fs=require('fs');const b=fs.readFileSync(process.argv[1]);const m=Buffer.from('ComputerUser native messaging launcher','latin1');process.stdout.write(b.includes(m)?'OWN':'FOREIGN')" $extHostPath 2>$null)
        $ownHost = ($probe -match 'OWN')
    } catch { $ownHost = $false }
    Report-Check -Name "Host nativo propio" -Status $ownHost `
        -SuccessMsg "es nuestro lanzador (no el binario de Codex)" `
        -ErrorMsg "extension-host.exe NO es nuestro lanzador (¿binario de Codex?)" `
        -FixMsg "Reinstala el paquete; reversion manual: copia extension-host.exe.bak-codex sobre extension-host.exe"

    Report-Check -Name "Host nativo: src\host.mjs" -Status (Test-Path $hostSrc) `
        -SuccessMsg "Presente (el lanzador resuelve ..\src\host.mjs)" `
        -ErrorMsg "Falta runtime\extension-host\src\host.mjs; el host no arrancaria" `
        -FixMsg "Reinstala el paquete completo (carpeta runtime\extension-host\src\)"
}

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

# Guardian del manifiesto: si falta cualquier fichero declarado, el navegador no
# carga la extension. El checker (scripts\check-extension-files.mjs) sale 1 y
# lista los que faltan. Se ejecuta con el node del runtime instalado.
$checkerPath = Join-Path $PSScriptRoot "check-extension-files.mjs"
if ($extExists) {
    if (-not (Test-Path $nodePath)) {
        Report-Check -Name "Ficheros del manifiesto" -Status $false `
            -ErrorMsg "Falta runtime\bin\node.exe para ejecutar el guardian" `
            -FixMsg "Ejecuta 'free-computer-user update' o reinstala con install.ps1"
    } elseif (-not (Test-Path $checkerPath)) {
        Report-Check -Name "Ficheros del manifiesto" -Status $false `
            -ErrorMsg "Falta scripts\check-extension-files.mjs" `
            -FixMsg "Reinstala el paquete completo (carpeta scripts\)"
    } else {
        $checkLines = @(& $nodePath $checkerPath $extensionDir 2>&1 | ForEach-Object { "$_" })
        $checkExit = $LASTEXITCODE
        $checkMsg = ($checkLines | Where-Object { $_ -and "$_".Trim() } | Select-Object -First 1)
        $checkMsg = "$checkMsg" -replace '^\[(OK|FALLO)\]\s*', ''
        if (-not $checkMsg) { $checkMsg = "el guardian no devolvio salida" }
        if ($checkExit -eq 0) {
            Report-Check -Name "Ficheros del manifiesto" -Status $true -SuccessMsg $checkMsg
        } else {
            Report-Check -Name "Ficheros del manifiesto" -Status $false `
                -ErrorMsg $checkMsg `
                -FixMsg "Reinstala o ejecuta 'free-computer-user update' (el manifest declara ficheros que no estan)"
        }
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

# Puente stdio: imprescindible para cualquier cliente sobre el SDK de Go de MCP
# (Antigravity, Cursor). node_repl.exe exige `initialize` y esos clientes abren con
# `server/discover`: sin puente, el servidor muere con EOF y nunca arranca.
$bridgePath = Join-Path $InstallDir "runtime\bin\mcp-bridge.mjs"
Report-Check -Name "Puente MCP stdio" -Status (Test-Path $bridgePath) `
    -SuccessMsg "runtime\bin\mcp-bridge.mjs presente" `
    -ErrorMsg "Falta runtime\bin\mcp-bridge.mjs (los clientes con server/discover no arrancaran)" `
    -FixMsg "Ejecuta 'free-computer-user update' o reinstala desde el release oficial"

# Las TRES copias del servicio de navegador deben llevar el parche de metadatos de
# turno: sin el, cualquier cliente que no sea Codex recibe
# "Missing required Codex turn metadata: session_id, turn_id".
$turnServiceCopies = @(
    (Join-Path $InstallDir "runtime\browser\browser-service.mjs"),
    (Join-Path $InstallDir "runtime\bin\node_modules\@oai\browser-desktop\scripts\browser-service.mjs"),
    (Join-Path $InstallDir "runtime\bin\node_modules\@oai\cua\dist\lib\js\oai_js_browser\dist\skill\scripts\browser-service.mjs")
) | Where-Object { Test-Path $_ }
$unpatched = @($turnServiceCopies | Where-Object {
    -not ((Get-Content $_ -Raw) -match "ComputerUser patch: default turn metadata")
})
Report-Check -Name "Metadatos de turno por defecto" -Status ($unpatched.Count -eq 0) `
    -SuccessMsg "las $($turnServiceCopies.Count) copias de browser-service.mjs aceptan clientes sin metadatos de Codex" `
    -ErrorMsg ("sin parche: " + (($unpatched | ForEach-Object { Split-Path $_ -Leaf }) -join ", ")) `
    -FixMsg "Ejecuta 'free-computer-user update' o reinstala desde el release oficial"

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

# Antigravity lee el servidor MCP de ~/.gemini/config/mcp_config.json y las skills
# globales de ~/.gemini/config/skills. La ruta antigua
# (~/.gemini/antigravity/mcp_config.json) ya NO se consulta: si la entrada solo
# esta ahi, Antigravity no la vera.
$antigravityConfig = Join-Path $env:USERPROFILE ".gemini\config\mcp_config.json"
$antigravityDir = Split-Path $antigravityConfig
$antigravityLegacy = Join-Path $env:USERPROFILE ".gemini\antigravity\mcp_config.json"
if (Test-Path $antigravityDir) {
    $hasAnti = (Test-Path $antigravityConfig) -and ((Get-Content $antigravityConfig -Raw) -match "computer-user")
    $legacyOnly = (-not $hasAnti) -and (Test-Path $antigravityLegacy) -and ((Get-Content $antigravityLegacy -Raw) -match "computer-user")
    if ($legacyOnly) {
        Write-Host "  [AVISO] computer-user esta en ~/.gemini/antigravity/mcp_config.json (ruta antigua): Antigravity no la leera." -ForegroundColor DarkYellow
    }
    Report-Check -Name "Antigravity MCP" -Status $hasAnti `
        -SuccessMsg "Registrado en ~/.gemini/config/mcp_config.json" `
        -ErrorMsg $(if ($legacyOnly) { "Solo esta en la ruta antigua: Antigravity no lo leera" } else { "No configurado en ~/.gemini/config/mcp_config.json" }) `
        -FixMsg "Ejecuta 'free-computer-user update' o install.ps1"

    # La entrada de computer-user TIENE que apuntar al puente. Antigravity usa el SDK
    # de Go de MCP: si `command` es node_repl.exe directo (o el shim manual
    # cu-mcp-shim.mjs de una version anterior), el arranque falla con EOF.
    $agyEntry = $null
    if ($hasAnti) {
        try {
            $agyJson = Get-Content $antigravityConfig -Raw | ConvertFrom-Json
            $agyEntry = $agyJson.mcpServers."computer-user"
        } catch { $agyEntry = $null }
    }
    $agyCommand = if ($agyEntry) { [string]$agyEntry.command } else { "" }
    $agyArgs = @()
    if ($agyEntry -and $agyEntry.args) { $agyArgs = @($agyEntry.args) }
    $agyBridgeFile = ($agyArgs | Where-Object { "$_" -match 'mcp-bridge\.mjs$' } | Select-Object -First 1)
    $agyPointsToBridge = [bool]($agyBridgeFile -and (Test-Path $agyCommand) -and (Test-Path "$agyBridgeFile"))
    $agyPointsToShim = [bool](($agyArgs | Where-Object { "$_" -match 'cu-mcp-shim' }).Count -gt 0) -or ($agyCommand -match 'cu-mcp-shim')
    $agyPointsToRepl = [bool]($agyCommand -match 'node_repl\.exe$')
    # La entrada del puente es lo que da el NAVEGADOR en Antigravity: es la ruta
    # verificada (Brave + YouTube + Gmail, rapida). Se informa como su propia linea, y el
    # escritorio va aparte (abajo) porque su soporte es otro asunto.
    if ($agyPointsToBridge) {
        Report-Check -Name "Antigravity navegador -> Puente MCP" -Status $true `
            -SuccessMsg "command=node.exe args=[mcp-bridge.mjs --disable-sandbox]"
    } elseif ($agyPointsToShim) {
        # Revertir al shim manual es una decision del usuario (desbloqueo temporal) y el
        # shim ARRANCA, asi que no es un fallo de instalacion: es un aviso. Pero conviene
        # decir la verdad medida: el shim tambien rota `turn-<N>` en cada `tools/call`, y
        # esa rotacion es la que invalida las capturas (`unknown screenshotId
        # screenshot-0`) en el flujo de dos celdas. El puente v1.0.13 usa una identidad
        # de turno estable y es la ruta recomendada.
        Write-Host "  [AVISO] Antigravity navegador -> shim manual cu-mcp-shim.mjs (revertido a proposito; arranca, no es un fallo)" -ForegroundColor Yellow
        Write-Host "          El shim rota turn-<N> en cada tools/call, que es la causa medida de 'unknown screenshotId screenshot-0'." -ForegroundColor Yellow
        Write-Host "          Solucion: 'free-computer-user update' (v1.0.13+) deja la entrada en node.exe mcp-bridge.mjs --disable-sandbox." -ForegroundColor Yellow
    } else {
        $why = if ($agyPointsToRepl) { "apunta a node_repl.exe directo (muere con server/discover)" }
        else { "no apunta al puente mcp-bridge.mjs" }
        Report-Check -Name "Antigravity navegador -> Puente MCP" -Status $false `
            -ErrorMsg "La entrada de computer-user $why" `
            -FixMsg "Ejecuta 'free-computer-user update' o install.ps1 (debe quedar: node.exe mcp-bridge.mjs --disable-sandbox)"
    }
    # Escritorio (computer user) en Antigravity: NO soportado por ahora. Es un AVISO, nunca
    # un FAIL (la integracion es correcta y el navegador funciona): el motor de escritorio
    # funciona pero de forma INTERMITENTE alli, por la identidad de turno (el helper cierra
    # el turno anterior al ver una clave de turno distinta) y por los marcadores de
    # interrupcion rancios. El escritorio esta verificado en DeepSeek Harness.
    Write-Host "  [AVISO] Antigravity escritorio (computer user) - NO soportado por ahora: funciona de forma intermitente." -ForegroundColor Yellow
    Write-Host "          Causa conocida: identidad de turno + marcadores de interrupcion rancios (ver 'Marcadores de interrupcion' abajo)." -ForegroundColor Yellow
    Write-Host "          En Antigravity usa el navegador (soportado); el escritorio esta verificado en DeepSeek Harness. v1.0.13 lo mitiga, no lo promete." -ForegroundColor Yellow
    # Shim manual de una version anterior: NO se borra (es del usuario), solo se avisa.
    $agyShimFile = Join-Path $antigravityDir "cu-mcp-shim.mjs"
    if (Test-Path $agyShimFile) {
        Write-Host "  [NOTA] $agyShimFile ya no se necesita: el puente oficial (runtime\bin\mcp-bridge.mjs) hace lo mismo y se actualiza con el paquete. Se deja intacto." -ForegroundColor DarkGray
    }

    $agySkillsLink = Join-Path $antigravityDir "skills"
    $agySkillsExpected = (Resolve-Path $globalSkills -ErrorAction SilentlyContinue).Path
    $agySkillsItem = Get-Item $agySkillsLink -Force -ErrorAction SilentlyContinue
    $agySkillsTargets = if ($agySkillsItem -and $agySkillsItem.Target) { @($agySkillsItem.Target) } else { @() }
    $agySkillsOk = $false
    foreach ($agySkillsTarget in $agySkillsTargets) {
        $agySkillsResolved = (Resolve-Path $agySkillsTarget -ErrorAction SilentlyContinue).Path
        if ($agySkillsResolved -and $agySkillsExpected -and ($agySkillsResolved -eq $agySkillsExpected)) { $agySkillsOk = $true }
    }
    Report-Check -Name "Antigravity Skills" -Status $agySkillsOk `
        -SuccessMsg "Junction ~/.gemini/config/skills -> ~/.agents/skills" `
        -ErrorMsg "Falta el junction ~/.gemini/config/skills -> ~/.agents/skills (Antigravity no vera las skills globales)" `
        -FixMsg "Ejecuta 'free-computer-user update' o install.ps1"
} elseif (Test-Path $antigravityLegacy) {
    $hasLegacy = (Get-Content $antigravityLegacy -Raw) -match "computer-user"
    Report-Check -Name "Antigravity MCP" -Status (-not $hasLegacy) `
        -SuccessMsg "Sin configuracion de Antigravity que migrar" `
        -ErrorMsg "computer-user solo esta en ~/.gemini/antigravity/mcp_config.json: Antigravity no lo leera" `
        -FixMsg "Ejecuta 'free-computer-user update' o install.ps1"
}

# Antigravity CLI: su estado vive en ~/.gemini/antigravity-cli (settings.json, mcp\
# con los ESQUEMAS de herramientas, brain, conversations, log). NO tiene
# mcp_config.json propio y NO tiene seccion MCP en settings.json: el CLI comparte la
# configuracion global ~/.gemini/config/mcp_config.json (verificado en los strings
# del binario: "Global Configuration: ~/.gemini/config/mcp_config.json (applies to
# all sessions)" y en los logs del CLI: "stored shared config permissions ... from
# C:\Users\User\.gemini\config\config.json"). Por eso NO hay que duplicar nada: el
# unico riesgo es que aparezca un settings.json con seccion MCP propia (esquema
# distinto) y el CLI deje de ver la entrada global.
$agyCliDir = Join-Path $env:USERPROFILE ".gemini\antigravity-cli"
if (Test-Path $agyCliDir) {
    $agyCliSettings = Join-Path $agyCliDir "settings.json"
    $agyCliOwnConfig = Join-Path $agyCliDir "mcp_config.json"
    $agyCliHasMcpSection = $false
    $agyCliMcpKey = ""
    if (Test-Path $agyCliSettings) {
        try {
            $agyCliJson = Get-Content $agyCliSettings -Raw | ConvertFrom-Json
            foreach ($key in @("mcpServers", "mcp", "enabledMcpServers", "mcp_settings")) {
                if ($agyCliJson.PSObject.Properties.Name -contains $key) {
                    $agyCliHasMcpSection = $true
                    $agyCliMcpKey = $key
                }
            }
        } catch {
            $agyCliHasMcpSection = $false
        }
    }
    Report-Check -Name "Antigravity CLI" -Status (-not $agyCliHasMcpSection) `
        -SuccessMsg $(if ($hasAnti) { "comparte ~/.gemini/config/mcp_config.json (la entrada global de computer-user); sin config MCP propia" } else { "comparte ~/.gemini/config/mcp_config.json (falta la entrada de computer-user)" }) `
        -ErrorMsg "settings.json del CLI define '$agyCliMcpKey': esquema MCP PROPIO que este doctor no cubre; NO se escribe a ciegas" `
        -FixMsg "Revisa ~/.gemini/antigravity-cli/settings.json y anade computer-user a mano con el esquema de esa clave"
    if (Test-Path $agyCliOwnConfig) {
        Write-Host "  [AVISO] $agyCliOwnConfig existe y el doctor NO lo cubre; revisa si el CLI lee ese fichero." -ForegroundColor DarkYellow
    }
    Write-Host "  [NOTA] El CLI lanza sus terminales en un escritorio aislado (WinSta0\exebox-...): ahi node_repl.exe no arranca (0xc0000142). Si lanzas el CLI desde tu consola (WinSta0\Default), el servidor MCP si funciona." -ForegroundColor DarkGray
}

# Marcadores de interrupcion del motor. `helper_transport.js` escribe un fichero VACIO en
#   <CODEX_HOME>\cache\computer-use\interrupts\<sesion>\<turno>
# cuando el helper aborta porque el usuario pulso Escape, y RECHAZA toda llamada con esa
# pareja (sesion, turno) mientras el fichero exista, con el mensaje "Computer Use was
# stopped by the user with the physical Escape key...". Nadie lo borra: ni el helper, ni el
# runtime, ni el cierre de turno. Una sesion nueva que reutilice la identidad (el shim
# antiguo numeraba turn-1, turn-2... desde cero en cada proceso; cualquier cliente que
# mande sus propios ids puede repetirlos) queda bloqueada desde la primera llamada, y solo
# se arregla borrando el fichero a mano. El puente v1.0.13 los limpia al arrancar; aqui se
# comprueba y se limpia exactamente lo mismo. AVISO, nunca FAIL: un marcador rancio no
# significa instalacion rota.
Write-Host ""
Write-Host "  -> Marcadores de interrupcion del motor..." -ForegroundColor Gray
$cuHome = Join-Path $InstallDir "home"
$interruptsRoot = Join-Path $cuHome "cache\computer-use\interrupts"
$bridgeSession = "default-mcp-session"
$bridgeInterrupts = Join-Path $interruptsRoot $bridgeSession
$bridgeMarkers = @()
if (Test-Path $bridgeInterrupts) {
    $bridgeMarkers = @(Get-ChildItem -Path $bridgeInterrupts -File -Force -ErrorAction SilentlyContinue)
}
if ($bridgeMarkers.Count -eq 0) {
    Report-Check -Name "Marcadores de interrupcion" -Status $true `
        -SuccessMsg "sin marcadores rancios en la sesion del puente ($bridgeSession)"
} else {
    Write-Host ("  [AVISO] Marcadores de interrupcion - {0} marcador(es) rancio(s) en {1}" -f $bridgeMarkers.Count, $bridgeInterrupts) -ForegroundColor Yellow
    Write-Host "          Bloquean el escritorio con el mensaje de la tecla Escape (causa conocida de la intermitencia en Antigravity)." -ForegroundColor Yellow
    $removedMarkers = 0
    foreach ($m in $bridgeMarkers) {
        try {
            Remove-Item -Force $m.FullName -ErrorAction Stop
            $removedMarkers++
        } catch { }
    }
    if ($removedMarkers -eq $bridgeMarkers.Count) {
        Write-Host ("          Limpiados los {0} (el puente v1.0.13 tambien los limpia al arrancar); no habia ninguna sesion viva detras." -f $removedMarkers) -ForegroundColor Yellow
    } else {
        Write-Host ("          Limpiados {0} de {1}: los que queden siguen bloqueando la sesion, borralos a mano." -f $removedMarkers, $bridgeMarkers.Count) -ForegroundColor Yellow
    }
}
# Otras sesiones (Codex y clientes que mandan sus propios ids): NO se tocan, solo se
# informan. Borrarlas podria desbloquear a proposito una sesion viva de otro cliente.
$otherMarkerSessions = @()
if (Test-Path $interruptsRoot) {
    $otherMarkerSessions = @(Get-ChildItem -Path $interruptsRoot -Directory -Force -ErrorAction SilentlyContinue | Where-Object {
        ($_.Name -ne $bridgeSession) -and (@(Get-ChildItem -Path $_.FullName -File -Force -ErrorAction SilentlyContinue).Count -gt 0)
    })
}
if ($otherMarkerSessions.Count -gt 0) {
    Write-Host ("  [NOTA] Otras sesiones con marcadores de interrupcion (no se tocan): " + (($otherMarkerSessions | ForEach-Object { $_.Name }) -join ", ")) -ForegroundColor DarkGray
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
