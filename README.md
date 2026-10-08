# ComputerUser (Free Computer User)

<p align="center">
  <img src="assets/intro.gif" alt="ComputerUser Intro Animation" width="750" />
</p>

<p align="center">
  <strong>Motor autónomo independiente de Computer Use (Windows UI Automation) y Control de Navegador (Chrome, Brave y Edge) para cualquier agente de IA.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
  <img src="https://img.shields.io/badge/Protocol-MCP%20Stdio%20(JSON--RPC)-8B5CF6?style=for-the-badge" alt="MCP Protocol" />
  <img src="https://img.shields.io/badge/Browser-Chrome%20%7C%20Brave%20%7C%20Edge-FF4500?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Browsers" />
  <img src="https://img.shields.io/badge/Harness-DeepSeek%20%7C%20Antigravity%20%7C%20Cursor-10B981?style=for-the-badge" alt="Harnesses" />
  <img src="https://img.shields.io/badge/Extension-Manifest%20V3-blue?style=for-the-badge" alt="Manifest V3" />
</p>

---

## Independiente por diseño

- **No requiere cuenta, token ni la app de Codex/OpenAI.** El runtime arranca en modo offline
  (`BROWSER_USE_DISABLE_AMBIENT_NETWORK=1`): no pide identidad, no envía telemetría y no hace
  llamadas a `chatgpt.com`.
- **Identidad propia**, sin colisiones con la extensión oficial: native host `com.victortrab.computeruser`
  y extensión con su propio ID (`hjfjdiahpgemdghjcnjmcdkdeapgplpd`), derivado de la clave pública
  del manifiesto. Nunca se escribe en las claves de registro de Codex.
- **Una sola skill de navegador** (`free-control-browser`) que cubre Chrome, Brave y Edge, con
  Chrome como navegador por defecto y selección explícita por instrucción del usuario.

---

## Instalación

En una terminal de PowerShell, ejecuta:

```powershell
irm https://raw.githubusercontent.com/VictorTrab/computerUser/master/scripts/install.ps1 | iex
```

El instalador descarga el paquete optimizado desde GitHub Releases, registra el Native Messaging Host
(`com.victortrab.computeruser`) en los navegadores, despliega las skills en `~/.agents/skills`,
sincroniza el shim `browser` y configura el servidor MCP en los arneses detectados.

---

## Comandos CLI (`free-computer-user`)

Disponible en PowerShell o CMD una vez instalado:

* **Diagnóstico de salud:**
  ```powershell
  free-computer-user doctor
  ```
* **Actualizar a la última versión:**
  ```powershell
  free-computer-user update
  ```
* **Desinstalar limpiamente:**
  ```powershell
  free-computer-user uninstall
  ```

---

## Cargar la Extensión (una vez por navegador)

1. Abre `chrome://extensions`, `brave://extensions` o `edge://extensions`.
2. Activa el modo de desarrollador.
3. Haz clic en "Cargar descomprimida" y selecciona:
   ```text
   C:\Users\<TuUsuario>\.free-computer-user\extension
   ```
4. Verifica que el ID sea `hjfjdiahpgemdghjcnjmcdkdeapgplpd` (si no coincide, el native host
   rechazará la conexión; ejecuta `free-computer-user doctor`).
5. En los detalles de la extensión, activa "Permitir acceso a URLs de archivo".

El puente funcional es el navegador donde cargues la extensión y que esté abierto: el agente usará
**Chrome por defecto** o el que le indiques explícitamente ("en Brave", "usa Edge").

---

## Ejemplos de Uso

Solicita las tareas directamente en lenguaje natural desde el chat de tu agente:

### Escritorio Windows (`free-computer-user`)
- "Lista las ventanas abiertas y dime el título de la activa."
- "Abre la calculadora de Windows y suma 45 + 12."
- "Captura el estado de la ventana activa y haz clic en Iniciar Sesión."

### Navegador (`free-control-browser`)
- "Revisa las pestañas abiertas en Chrome." (por defecto)
- "Abre YouTube en Brave y busca este tema."
- "En Edge, entra a `file:///C:/proyectos/docs/index.html` y resume el contenido."

---

## Estructura del Sistema

```text
free-computer-user/
├── bin/
│   ├── free-computer-user.cmd     # Wrapper para consola CMD
│   └── free-computer-user.ps1     # CLI de administración en PowerShell
├── runtime/
│   ├── bin/                       # Servidor MCP Stdio (node_repl.exe) y runtime Node
│   │   └── node_modules/browser/  # Shim: permite `await import("browser")`
│   ├── browser/                   # Servicio de automatización web (parche local propio)
│   └── extension-host/            # Host nativo de mensajería PROPIO (ya no es el de Codex)
│       ├── windows/x64/extension-host.exe   # Lanzador nativo (el `path` del manifiesto)
│       ├── src/host.mjs                     # El host: pipe + framing + puente JSON-RPC
│       └── launcher/                        # Fuente Rust + build.ps1 del lanzador
├── extension/                     # Extensión Manifest V3 (ID propio) para Chrome, Brave y Edge
├── home/
│   ├── config.toml                # Hook de fin de turno
│   └── computer-use/config.toml   # Allowlist de aplicaciones autorizadas
├── skills/
│   ├── free-computer-user/        # Guía técnica para automatización de escritorio
│   └── free-control-browser/      # Guía única para Chrome, Brave y Edge
├── rules/
│   └── AGENTS.md                  # Políticas de ejecución y gobernanza operativa
├── launch/
│   ├── run_mcp.ps1                # Lanzador de consola con el entorno completo
│   └── run_mcp.cmd
├── scripts/
│   ├── install.ps1                # Instalador universal
│   ├── update.ps1                 # Actualizador
│   ├── uninstall.ps1              # Desinstalador
│   ├── doctor.ps1                 # Verificador de diagnóstico
│   ├── smoke-test.ps1             # Smoke test del puente (sin navegador real)
│   ├── smoke-browser-bridge.mjs
│   └── package.ps1                # Empaquetador CI/CD (valida + empaqueta)
└── adapters/
    └── universal_runner.py        # Runner CLI para pruebas directas
```

---

## Verificación antes de publicar

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-test.ps1
```

El smoke test levanta el `node_repl.exe` real y **nuestro** `extension-host.exe`, se hace pasar por la
extensión (native messaging) y comprueba de extremo a extremo:

- que `await import("browser")` resuelve (shim dentro de `node_modules`);
- que el runtime funciona con un `CODEX_HOME` **sin** `auth.json` (sin token ni red);
- que `tabs.list()`, `user.openTabs()` y `nameSession()` responden.

`scripts/package.ps1` lo ejecuta automáticamente antes de empaquetar, así que ningún release puede
salir con el puente roto. Si tienes Chrome/Brave abiertos con la extensión cargada, ciérralos antes:
el runtime descubre los pipes vivos de esos navegadores y el smoke puede no ser concluyente.

---

## Host nativo propio

El host de mensajería nativa (`runtime\extension-host\`) es **nuestro**, no el binario de Codex
(`extension-host.exe` de `@oai`). Está formado por:

- `windows\x64\extension-host.exe` — lanzador nativo (Rust, ~240 KB) que arranca `src\host.mjs` con
  el `node.exe` del runtime heredando los pipes del navegador. El navegador necesita una imagen
  ejecutable: `CreateProcessW` no puede lanzar un `.cmd` ni un `.mjs`.
- `src\host.mjs` (+ `framing.mjs`, `trace.mjs`) — el host: crea el named pipe
  `\\.\pipe\codex-browser-use\<uuid4>`, habla `uint32LE + UTF-8 JSON` con el navegador por stdio y
  hace de puente JSON-RPC 2.0 con `node_repl.exe`, con reescritura de ids
  (`native-host:<cliente>:<id>`) y el namespace host-local `codexRuntime/*`.

**Qué se pierde con él** (limitaciones conocidas y aceptadas):

- El **sidepanel de Codex no arranca**: no está implementado el proxy WebSocket al app-server, así
  que `codexRuntime/ensure` responde `no_matching_codex_install`.
- No implementa `codexRuntime/tabContextAsset/*`, `openLocalFile`, la noción de sesión
  (`metadata.codexSessionId`), la ACL del named pipe (ni su secreto por sesión) ni la firma de
  código del `.exe`.

El puente navegador↔runtime —que es lo que usan las skills— es completo y está validado 9/9 en
Chrome y en Brave con la extensión real.

**Trazas de protocolo.** El host escribe por defecto un JSONL con todos los frames que cruzan en
`runtime\extension-host\logs\host-<pid>.jsonl` (es el material con el que se depuró el protocolo).
Para llevarlas a otro sitio o silenciarlas: define `CU_HOST_TRACE` (una ruta, o `NUL` para
descartarlas) o pasa `--trace=<fichero>`. `--quiet` solo reduce el chárter de stderr; la traza sigue.
Las trazas son estado, no configuración: borrar `runtime\extension-host\logs\` es seguro.

**Reversión al binario de Codex** (se conserva, no se borra):

```powershell
# repo y/o instalación
Copy-Item runtime\extension-host\windows\x64\extension-host.exe.bak-codex `
          runtime\extension-host\windows\x64\extension-host.exe -Force
```

En la instalación la ruta es `C:\Users\User\.free-computer-user\runtime\extension-host\windows\x64\`.
El manifiesto y las claves del registro **no cambian** al revertir (el `path` es el mismo).
Recompilar el lanzador propio: `runtime\extension-host\launcher\build.ps1`.

---

## Seguridad y Aislamiento

- **Control de procesos:** La lista blanca en `home/computer-use/config.toml` restringe los ejecutables sobre los cuales el motor puede interactuar.
- **Sin telemetría externa:** el modo offline desactiva la red ambiental; el único tráfico es el que
  genere la propia navegación del usuario.
- **Sesión real:** Interactúa con tus navegadores y ventanas locales existentes sin necesidad de exponer puertos remotos de depuración.
- **Sin tocar Codex:** el instalador usa su propio native host y su propia extensión; las claves y
  archivos de la app Codex nunca se modifican.
