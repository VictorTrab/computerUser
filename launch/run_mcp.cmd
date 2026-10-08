@echo off
setlocal

set "CODEX_HOME=C:\Users\User\projects\computerUser\home"
set "NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS=1000"
set "NODE_REPL_NODE_MODULE_DIRS=C:\Users\User\projects\computerUser\runtime\bin\node_modules"
set "NODE_REPL_NODE_PATH=C:\Users\User\projects\computerUser\runtime\bin\node.exe"
set "NODE_REPL_TRUSTED_CODE_PATHS=C:\Users\User\projects\computerUser\home;C:\Users\User\projects\computerUser\runtime\bin\node_modules;C:\Users\User\projects\computerUser\runtime\browser"
set "NODE_REPL_TRUSTED_SERVICES={\"browser\":\"C:/Users/User/projects/computerUser/runtime/browser/browser-service.mjs\",\"sky\":\"@oai/sky/service\"}"
set "SKY_CUA_NATIVE_PIPE=0"
set "SKY_CUA_NATIVE_PIPE_DIRECTORY=\\.\pipe\codex-computer-use-149f0122-3721-4a5a-883d-38d414b0ec25"
set "BROWSER_USE_AVAILABLE_BACKENDS=chrome,iab"
set "BROWSER_USE_TINYSKY_ENABLED=1"
set "BROWSER_USE_SECURITY_MODE=disabled-for-local-testing"
set "BROWSER_USE_FULL_CDP_ACCESS_ENABLED=1"
set "BROWSER_USE_CODEX_APP_BUILD_FLAVOR=prod"
set "BROWSER_USE_CODEX_APP_VERSION=26.915.31945"

"C:\Users\User\projects\computerUser\runtime\bin\node_repl.exe" --disable-sandbox %*
