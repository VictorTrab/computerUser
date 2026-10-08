param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)

$ErrorActionPreference = "Stop"

$env:CODEX_HOME = "C:\Users\User\projects\computerUser\home"
$env:NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS = "1000"
$env:NODE_REPL_NODE_MODULE_DIRS = "C:\Users\User\projects\computerUser\runtime\bin\node_modules"
$env:NODE_REPL_NODE_PATH = "C:\Users\User\projects\computerUser\runtime\bin\node.exe"
$env:NODE_REPL_TRUSTED_CODE_PATHS = "C:\Users\User\projects\computerUser\home;C:\Users\User\projects\computerUser\runtime\bin\node_modules;C:\Users\User\projects\computerUser\runtime\browser"
$env:NODE_REPL_TRUSTED_SERVICES = '{"browser":"C:/Users/User/projects/computerUser/runtime/browser/browser-service.mjs","sky":"@oai/sky/service"}'
$env:SKY_CUA_NATIVE_PIPE = "0"
$env:SKY_CUA_NATIVE_PIPE_DIRECTORY = "\\.\pipe\codex-computer-use-149f0122-3721-4a5a-883d-38d414b0ec25"
$env:BROWSER_USE_AVAILABLE_BACKENDS = "chrome,iab"
$env:BROWSER_USE_TINYSKY_ENABLED = "1"
$env:BROWSER_USE_SECURITY_MODE = "disabled-for-local-testing"
$env:BROWSER_USE_FULL_CDP_ACCESS_ENABLED = "1"
$env:BROWSER_USE_CODEX_APP_BUILD_FLAVOR = "prod"
$env:BROWSER_USE_CODEX_APP_VERSION = "26.915.31945"

$exe = "C:\Users\User\projects\computerUser\runtime\bin\node_repl.exe"
$argsList = @("--disable-sandbox") + $ExtraArgs

& $exe @argsList
