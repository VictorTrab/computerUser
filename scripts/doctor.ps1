# Diagnóstico de salud para Free Computer User
$InstallDir = (Resolve-Path "$PSScriptRoot\..").Path

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

# 2. Native Messaging Host en Registro de Windows
Write-Host ""
Write-Host "[2/6] Verificando Registro de Windows (Native Messaging Host)..." -ForegroundColor Cyan
$regKeys = @(
    @{ Browser = "Google Chrome"; Path = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.openai.codexextension" },
    @{ Browser = "Brave Browser"; Path = "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.openai.codexextension" },
    @{ Browser = "Microsoft Edge"; Path = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.openai.codexextension" }
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
$manifestPath = Join-Path $InstallDir "extension\manifest.json"
$extExists = Test-Path $manifestPath
Report-Check -Name "Manifest V3" -Status $extExists `
    -SuccessMsg "Manifiesto y assets presentes" `
    -ErrorMsg "No se encuentra extension\manifest.json"

Write-Host "      -> Para cargar en Chrome/Brave: activa 'Modo Desarrollador' en chrome://extensions y carga descomprimida:" -ForegroundColor DarkGray
Write-Host "         $InstallDir\extension" -ForegroundColor DarkGray

# 4. Skills Globales en ~/.agents y ~/.dsh
Write-Host ""
Write-Host "[4/6] Verificando Skills de Agentes..." -ForegroundColor Cyan
$globalSkills = Join-Path $env:USERPROFILE ".agents\skills"
$dshSkills = Join-Path $env:USERPROFILE ".dsh\skills"

$gCu = Test-Path (Join-Path $globalSkills "free-computer-user\SKILL.md")
$gCh = Test-Path (Join-Path $globalSkills "free-control-chrome\SKILL.md")
Report-Check -Name "Skills Globales (~/.agents)" -Status ($gCu -and $gCh) `
    -SuccessMsg "free-computer-user y free-control-chrome instaladas" `
    -ErrorMsg "Faltan skills en ~/.agents\skills" `
    -FixMsg "Ejecuta 'free-computer-user update' para desplegarlas"

if (Test-Path (Join-Path $env:USERPROFILE ".dsh")) {
    $dCu = Test-Path (Join-Path $dshSkills "free-computer-user\SKILL.md")
    $dCh = Test-Path (Join-Path $dshSkills "free-control-chrome\SKILL.md")
    Report-Check -Name "Skills DeepSeek (~/.dsh)" -Status ($dCu -and $dCh) `
        -SuccessMsg "Sincronizadas con DeepSeek Harness" `
        -ErrorMsg "Faltan skills en ~/.dsh\skills"
}

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
Report-Check -Name "mcp_config.json Local" -Status (Test-Path $mcpConfigLocal) `
    -SuccessMsg "Archivo de servidor MCP disponible" `
    -ErrorMsg "Falta mcp_config.json"

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
