param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)

$ErrorActionPreference = "Stop"

# Rutas derivadas de la ubicacion del script: funciona en cualquier checkout.
$Root = (Resolve-Path "$PSScriptRoot\..").Path
$Bin = Join-Path $Root "runtime\bin"
$HomeDir = Join-Path $Root "home"
$BrowserDir = Join-Path $Root "runtime\browser"

$env:CODEX_HOME = $HomeDir
$env:NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS = "1000"
$env:NODE_REPL_NODE_MODULE_DIRS = Join-Path $Bin "node_modules"
$env:NODE_REPL_NODE_PATH = Join-Path $Bin "node.exe"
$env:NODE_REPL_TRUSTED_CODE_PATHS = "$HomeDir;$(Join-Path $Bin 'node_modules');$BrowserDir"
$env:NODE_REPL_TRUSTED_SERVICES = '{"browser":"' + ((Join-Path $BrowserDir "browser-service.mjs").Replace("\", "/")) + '","sky":"@oai/sky/service"}'
$env:SKY_CUA_NATIVE_PIPE = "0"
$env:SKY_CUA_NATIVE_PIPE_DIRECTORY = "\\.\pipe\codex-computer-use-149f0122-3721-4a5a-883d-38d414b0ec25"
$env:BROWSER_USE_AVAILABLE_BACKENDS = "chrome,iab"
$env:BROWSER_USE_TINYSKY_ENABLED = "1"
$env:BROWSER_USE_SECURITY_MODE = "disabled-for-local-testing"
$env:BROWSER_USE_FULL_CDP_ACCESS_ENABLED = "1"
# Modo independiente: sin token ni red ambiental de OpenAI/Codex.
$env:BROWSER_USE_DISABLE_AMBIENT_NETWORK = "1"
$env:BROWSER_USE_CODEX_APP_BUILD_FLAVOR = "prod"
$env:BROWSER_USE_CODEX_APP_VERSION = "26.915.31945"

$exe = Join-Path $Bin "node_repl.exe"
$argsList = @("--disable-sandbox") + $ExtraArgs

& $exe @argsList
