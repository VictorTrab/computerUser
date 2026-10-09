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

## Compatibilidad (v1.0.13)

Tabla honesta de lo verificado. **Soportado** = probado de extremo a extremo en esa combinación.
**No soportado por ahora** = puede funcionar, pero falla de forma **intermitente** y no se promete.

| Cliente | Navegador (`free-control-browser`) | Escritorio / computer user (`free-computer-user`) |
| :-- | :-- | :-- |
| **Antigravity** (app y CLI) | **Soportado**: verificado con Brave + YouTube + Gmail (rápido), a través del puente MCP | **No soportado por ahora**: funciona pero es **intermitente**. Causa conocida: identidad de turno y marcadores de interrupción rancios |
| **DeepSeek Harness** | **Soportado** | **Soportado** (es donde está verificado) |
| **Otros clientes MCP estándar** (Cursor, Claude Code…) | Genérico y **opcional**: `runtime\bin\mcp-bridge.mjs` es un adaptador MCP stdio sin nada específico de un cliente; úsalo si tu cliente abre con `server/discover` | Genérico, sin verificación específica: el escritorio necesita metadatos de turno **estables** (el puente los inyecta) |

Matices que conviene tener a mano:

- El **escritorio en Antigravity no está retirado**: la integración (entrada del puente en
  `~/.gemini/config/mcp_config.json` y `free-control-browser` en `~/.gemini/config/skills`) se mantiene
  porque el **navegador depende de ella**. Lo que no se promete es la fiabilidad del computer user allí.
  Si el cliente es Antigravity, usa el navegador.
- `adapters\universal_runner.py` era el adaptador para lanzar el cliente desde el escritorio real
  (forzando `WinSta0\Default`). El **navegador no lo necesita** y el escritorio verificado va por el
  puente, así que **no viaja en el paquete**: se queda en el repositorio como herramienta de
  desarrollo (ver «Estructura del Sistema» y `scripts\package.ps1`).

---

## Qué skill se despliega en cada arnés (v1.0.14)

Cada arnés lee las skills de un sitio distinto. Este es el reparto, a propósito y con su motivo:

| Arnés / cliente | Carpeta donde se despliega | `free-computer-user` (escritorio) | `free-control-browser` (navegador) | Por qué |
| :-- | :-- | :-- | :-- | :-- |
| **DeepSeek Harness** | `~/.dsh/skills/` | **Sí** | **Sí** | Es el arnés donde el escritorio está verificado: necesita **las dos** skills. |
| **Gemini / Antigravity** (app y CLI) | `~/.gemini/config/skills/` (**carpeta real**) | No | **Sí** | Antigravity lee las skills globales de ahí. Solo se despliega la del navegador porque el **escritorio no está soportado** allí; y como carpeta real, no como junction, para no reexponer lo que ya no debe verse. |
| **Codex** | `~/.agents/skills/` → **a propósito SIN USAR** | No | No | Codex lee esa carpeta como skills globales y **usaba las nuestras sin que se lo pidieras**. Desde v1.0.14 el instalador **no escribe nunca** ahí (ni la crea, ni la borra: si existe, la deja como esté). El `doctor` avisa si encuentra nuestras skills ahí. |
| **Otros clientes MCP** (Cursor, Claude Code…) | — | — | — | No consumen nuestras skills: usan el servidor MCP (`runtime\bin\mcp-bridge.mjs`). |

Notas:

- El instalador es **idempotente**: dos ejecuciones dejan exactamente los mismos ficheros (mismo SHA256).
- El instalador **solo crea y actualiza lo suyo**: no borra ficheros ni carpetas del usuario. La
  limpieza de skills antiguas (`free-control-chrome/brave/edge`) se limita a los directorios que
  gestiona, y el junction antiguo `~/.gemini/config/skills -> ~/.agents/skills` se sustituye por la
  carpeta real (se borra el enlace, nunca su destino).
- `~/.agents/skills` puede quedarse vacía: es correcto. El desinstalador borra de ahí **solo** nuestras
  dos carpetas, jamás la carpeta contenedora ni skills de terceros.

---

## Instalación

En una terminal de PowerShell, ejecuta:

```powershell
irm https://raw.githubusercontent.com/VictorTrab/computerUser/master/scripts/install.ps1 | iex
```

El instalador descarga el paquete optimizado desde GitHub Releases, registra el Native Messaging Host
(`com.victortrab.computeruser`) en los navegadores, despliega las skills en `~/.dsh/skills` (las dos) y
en `~/.gemini/config/skills` (solo la del navegador), sincroniza el shim `browser` y configura el
servidor MCP en los arneses detectados. En `~/.agents/skills` **no escribe nada** (ver la tabla de
arriba).

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
│   │   ├── mcp-bridge.mjs         # Puente stdio para clientes con `server/discover` (Antigravity, Cursor)
│   │   └── node_modules/browser/  # Shim: permite `await import("browser")`
│   ├── browser/                   # Servicio de automatización web (parche local propio)
│   │   ├── browser-service.mjs    # + parche de metadatos de turno para clientes no-Codex
│   │   └── patch-turn-metadata.mjs # Aplicador idempotente de ese parche (3 copias)
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
│   ├── test-mcp-bridge.mjs        # Prueba directa del puente stdio (discover/initialize/tools)
│   ├── e2e-browser-bridge.mjs     # E2E real de navegador por el puente (Brave + YouTube)
│   ├── e2e-mcp-bridge.mjs         # E2E real de escritorio por el puente (Calculadora + captura)
│   ├── ab-turn-identity.mjs       # A/B: identidad de turno estable vs `turn-<N>` rotativo
│   ├── ab-turn-closure.mjs        # A/B: cerrar el turno a mano no invalida el estado
│   ├── ab-interrupt-markers.mjs   # A/B: marcadores de interrupcion rancios (Escape)
│   ├── verify-turn-metadata-patch.mjs  # A/B: el parche de metadatos es necesario y suficiente
│   ├── patch-turn-metadata.mjs    # Wrapper del aplicador que vive en runtime\browser
│   └── package.ps1                # Empaquetador CI/CD (valida + empaqueta)
└── adapters/                      # Solo en el repo: NO viaja en el paquete
    └── universal_runner.py        # Runner CLI para lanzar el cliente desde el escritorio real
```

`adapters\universal_runner.py` **no se empaqueta** (excluido en `scripts\package.ps1`, que aborta si
aparece en el zip): era la via para lanzar el cliente desde el escritorio real forzando
`WinSta0\Default`, y ni el navegador ni el escritorio verificado por el puente lo necesitan. Se
conserva en el repositorio como herramienta de desarrollo.

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

Además, y también dentro del empaquetado:

```powershell
# Puente MCP stdio: server/discover -> -32601, initialize y tools/list
node scripts\test-mcp-bridge.mjs . --fast      # añade --full para list_apps + listBrowsers
# A/B del parche de metadatos de turno (demuestra que el parche es necesario y suficiente)
node scripts\verify-turn-metadata-patch.mjs .
# A/B de la identidad de turno: `turn-<N>` rotativo falla, identidad estable funciona
node scripts\ab-turn-identity.mjs install        # puente instalado (antes del arreglo)
node scripts\ab-turn-identity.mjs repo           # puente del repo (debe dar OK)
node scripts\ab-turn-identity.mjs direct-rotating
# A/B del cierre a mitad de sesion: turn_ended y el hook no rompen el estado; js_reset si
node scripts\ab-turn-closure.mjs none ; node scripts\ab-turn-closure.mjs tool ; node scripts\ab-turn-closure.mjs reset
# A/B de los marcadores de interrupcion (escritorio): antes bloquea, despues limpia y dibuja
node scripts\ab-interrupt-markers.mjs before ; node scripts\ab-interrupt-markers.mjs after
# E2E real de navegador por el puente (Brave + YouTube): pestana, DOM y captura
node scripts\e2e-browser-bridge.mjs --browser brave --url https://www.youtube.com
# Sonda del overlay (`CodexComputerUseCursorOverlay`) y del hijo --system-cursor-manager
powershell -NoProfile -File scripts\probe-overlay.ps1 -Label antes
```

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

## Compatibilidad con cualquier cliente MCP (Antigravity, Cursor…)

El motor habla MCP stdio. Los clientes construidos sobre el **SDK de Go de MCP**
(`modelcontextprotocol/go_sdk`, Antigravity, Cursor) no abren la conversación con
`initialize`, sino con un sondeo `server/discover` (protocolo `2026-07-28`) para negociar
versión. `node_repl.exe` (rmcp 1.5.0) exige `initialize` como primer mensaje: cierra la
conexión (`EOF`) y el cliente marca el servidor como `ERROR` sin relanzarlo. Por eso el
paquete incluye un **puente stdio propio**, `runtime\bin\mcp-bridge.mjs`, que se registra
como `command` en los clientes no-Codex:

1. responde el `server/discover` con `{"code":-32601,"message":"Method not found: server/discover"}`
   **sin reenviarlo** al hijo, de modo que el cliente hace *fallback* a `initialize` sobre la
   misma tubería y el mismo proceso;
2. inyecta `_meta["x-codex-turn-metadata"]` (`session_id` / `turn_id` / `thread_source`) en cada
   `tools/call` cuando el cliente no lo manda — los clientes no-Codex no lo mandan, y
   `browser-service.mjs` abortaba con `Missing required Codex turn metadata`. La identidad que inyecta
   es **una sola y estable durante toda la sesión del cliente** (v1.0.13; ver «Identidad de turno»
   más abajo);
3. auto-responde `elicitation/create` del hijo con `{"action":"accept","content":{"persist":"session"}}`
   (`sky-guard` ya validó la allowlist, así que nadie dibuja el diálogo modal);
4. reenvía todo lo demás en ambos sentidos, preservando el framing (una línea JSON por mensaje).

Además, las **tres copias** de `browser-service.mjs` (`runtime\browser`, `@oai/browser-desktop` y
`@oai/cua`) llevan el parche de metadatos por defecto que aplica
`runtime\browser\patch-turn-metadata.mjs`. Sin el parche, un `tools/call` sin `_meta` falla con
`Missing required Codex turn metadata: session_id, turn_id`; con él, se generan valores por
defecto (`default-mcp-session` / `turn-<N>`) y el comportamiento con clientes Codex no cambia.

### Qué se registra y dónde

| Cliente | Fichero | `command` |
| :-- | :-- | :-- |
| Antigravity (app) | `~/.gemini/config/mcp_config.json` | `runtime\bin\node.exe` |
| Antigravity CLI | **el mismo fichero** (no tiene config MCP propia) | `runtime\bin\node.exe` |
| DeepSeek Harness | `~/.dsh/profiles/desktop/cordis.patch.yml` | `node_repl.exe` (dsh reintenta y no lo necesita) |
| Claude Code / Cursor | `~/.claude.json` / `~/.cursor\mcp.json` | `node_repl.exe` |

En los tres casos `args` es `["<install>\runtime\bin\mcp-bridge.mjs", "--disable-sandbox"]` para
Antigravity (el puente pasa el `--disable-sandbox` al hijo).

### Antigravity CLI: comparte la configuración

`~/.gemini/antigravity-cli\` (con `settings.json`, `mcp\`, `brain\`, `conversations\`, `log\`…) es
el **directorio de datos** del CLI, no su configuración MCP: **no contiene ningún
`mcp_config.json`** y su `settings.json` **no tiene sección MCP**. El CLI lee la configuración
global compartida:

- strings del binario (`resources\bin\language_server.exe`): *«Global Configuration:
  `~/.gemini/config/mcp_config.json` (applies to all sessions)»*;
- logs del CLI (`~/.gemini/antigravity-cli\log\cli-*.log`): *«stored shared config permissions …
  from `C:\Users\User\.gemini\config\config.json`»*.

Por eso el instalador **no escribe nada** en `~/.gemini/antigravity-cli`: duplicar la entrada sería
un error (esquema no verificado). Basta con que `~/.gemini/config/mcp_config.json` apunte al puente.
`doctor` informa además si algún día aparece una sección MCP propia en el `settings.json` del CLI.

**Salvedad medida (no prometida):** si el CLI lanza sus procesos hijo en el escritorio aislado
(`WinSta0\exebox-…`), ahí `node_repl.exe` **no arranca** (`0xc0000142`) y el servidor MCP no
funcionará. Si el CLI corre en `WinSta0\Default` (el caso normal cuando lo lanzas desde tu propia
consola), el servidor MCP funciona igual que en la app de escritorio.

### El shim manual ya no hace falta

Si en una versión anterior se creó a mano `~/.gemini/config/cu-mcp-shim.mjs`, **no se borra** (es del
usuario) pero **ya no se usa**: el puente oficial hace exactamente lo mismo y se actualiza con el
paquete. `doctor` avisa si la entrada de `computer-user` sigue apuntando al shim.

---

## Fin de turno: liberar el motor

El motor **no** se apaga cuando el agente devuelve su última acción. Si el turno no se cierra, el
helper de Computer Use mantiene su overlay de cursor en pantalla (clase
`CodexComputerUseCursorOverlay`, «ComputerUser is working now.. Esc to cancel»), su hijo
`--system-cursor-manager` sigue vivo y la sesión de navegador queda enganchada. Medido en A/B sobre
la instalación real, con el servidor MCP vivo:

| Estado | `codex-computer-use.exe` | `--system-cursor-manager` | overlay | `turnEnded` al navegador |
| :-- | :-- | :-- | :-- | :-- |
| Tarea terminada, sin cierre | vivo | vivo | visible | no |
| Tras `turn_ended` (herramienta MCP) | vivo | vivo | **visible** | sí (si los ids casan) |
| Tras el hook `notify` (v1.0.12) | vivo (se reutiliza) | **muerto** | **ninguno** | — |
| Tras el hook `notify` (v1.0.13, re-medido) | vivo | **vivo** | **visible** | — |
| Tras cerrar el cliente (el puente mata `node_repl.exe`) | muerto | muerto | ninguno | — |
| Tras `js_reset` | muerto | muerto | ninguno | — |

**Corrección medida en v1.0.13.** La fila del hook de v1.0.12 **no** se reproduce hoy en la instalación
standalone (`SKY_CUA_NATIVE_PIPE=0`): disparando `codex-computer-use.exe turn-ended` con los ids reales
leídos de `nodeRepl.requestMeta["x-codex-turn-metadata"]` **y** también con ids simples
(`cu-hook-test` / `turn-1`), la ventana `CodexComputerUseCursorOverlay` y el hijo
`--system-cursor-manager` siguen vivos (sonda `scripts\probe-overlay.ps1`). El evento con nombre que
espera el helper (`Local\CodexComputerUseTurnEnded-*`) tampoco aparece entre los candidatos construidos
con esos ids. Lo que **sí** libera el motor, medido: que termine el proceso cliente (el puente mata
`node_repl.exe` y el helper se va con él) o `js_reset`. Por eso las skills ya no mandan cerrar a mano:
es innecesario y puede no funcionar.

Hay por tanto **dos** mecanismos, y ninguno sustituye al otro:

1. **`turn_ended`** (herramienta MCP del propio servidor). Es la señal de fin de turno. `node_repl`
   la reenvía a las librerías de confianza; la única que registra un handler es `browser-service.mjs`,
   que la usa para soltar la sesión de navegador: desengancha las pestañas CDP
   (`clipboard.cleanupPageClipboards()` + `cdp.detachAllTabs()`) y manda `turnEnded` a la extensión.
   `@oai/sky` no la ve: el motor de escritorio no se entera.
2. **El hook nativo** `codex-computer-use.exe turn-ended <json>` (el `notify` que Codex escribe en
   `<CODEX_HOME>\config.toml`). Según su diseño retira el overlay y el `--system-cursor-manager`
   (señala el evento `Local\CodexComputerUseTurnEnded-*`) y los identificadores importan: con un
   `session_id`/`turn_id` que no sean los del turno que acaba de correr, el evento no casa y no libera
   nada. **Aviso medido**: en la instalación standalone actual el hook no retiró el overlay ni con los
   ids reales ni con ids simples (ver la corrección de arriba).

**Quién lo hace ahora**

- **Skills** (`free-computer-user` §9 y `free-control-browser` §7): instruyen al agente para **no**
  cerrar el turno a mano — ni `turn_ended`, ni el hook nativo, ni `js_reset` durante la tarea ni entre
  celdas. El cierre es de la **capa cliente** (Codex/DSH lo mandan al final del turno; el puente lo
  normaliza). Solo como último recurso, si el cliente no cierra nada y el usuario reporta el overlay o
  pestañas retenidas con la tarea ya terminada, se cierra una vez y se avisa en el mensaje final.
  `js_reset` deja de ser el «cierre de emergencia» por metadatos vacíos: los metadatos vacíos no son un
  error (DeepSeek Harness no manda ninguno y el camino de escritorio funciona).
- **Puente MCP** (`runtime\bin\mcp-bridge.mjs`, el camino de Antigravity): mantiene **una identidad de
  turno estable** por sesión y **normaliza** `turn_ended` a ella (rellena
  `hook_event_name`/`session_id`/`turn_id` si el cliente no los conoce). Así el cierre surte efecto con
  los ids vigentes y repetirlo es inofensivo; nunca rota la identidad, que es lo que rompía el
  escritorio (ver la tabla A/B/C siguiente). El sufijo aleatorio del `turn_id` evita reactivar un
  fichero de interrupción rancio (`<CODEX_HOME>\cache\computer-use\interrupts\<sesión>\<turno>`, que
  nadie limpia) de una sesión anterior.
- **Adaptador** (`adapters\universal_runner.py`, **solo en el repo: no viaja en el paquete**):
  genera la identidad del turno (una por turno del bucle, **estable dentro del turno**), la manda en
  `_meta` en cada `tools/call` y cierra el turno al salir del bucle (también si el LLM falla o se
  agotan los pasos): `turn_ended` + hook nativo, best-effort.
- **Arnés de pruebas** (`dev\harness.mjs`): igual, al cerrar el turno (`end_of_turn`), con
  `park_ms` para poder medir la liberación desde fuera.

**Identidad de turno: por qué es estable y no rota (v1.0.13, medido)**

El transporte del helper nativo (`helper_transport.js`, la ruta `SKY_CUA_NATIVE_PIPE=0`) calcula una
clave de turno (`codexHome/session/turn`) y, cuando llega una llamada con una clave **distinta**, manda
`end_turn` del turno anterior al helper **antes** de ejecutar la nueva. `end_turn` cierra ese turno
dentro de `codex-computer-use.exe`, que tira su registro de capturas: la siguiente acción por
coordenadas falla con `unknown screenshotId screenshot-0` y el helper se reinicializa (overlay y cursor
manager arrancados otra vez) con la latencia que eso cuesta. Medido A/B con un cliente real por stdio
sobre Paint (`scripts\ab-turn-identity.mjs`, informes en `%TEMP%\cu-ab\*.json`):

| Variante | Identidad de turno | `sky.drag` con el `screenshotId` de la captura anterior |
| :-- | :-- | :-- |
| **A** · puente instalado v1.0.12 | `turn-<N>` nuevo en cada `tools/call` | **falla**: `unknown screenshotId screenshot-0` |
| **B** · el mismo puente, ids estables | una identidad para toda la sesión | **OK** |
| **C** · `node_repl.exe` directo | `_meta` rotando por llamada | **falla**: `unknown screenshotId screenshot-0` |
| **C** · `node_repl.exe` directo | `_meta` estable | **OK** |

C aísla la causa: **no** es el puente, es la rotación de identificadores (el shim manual antiguo rotaba
`turn-<N>` por llamada y cae en lo mismo). DeepSeek Harness no manda `_meta`, así que la clave de turno
es `null` y `end_turn` nunca dispara: por eso ahí no se ve el fallo.

**D · cerrar el turno a mano no invalida el estado (medido).** Con identidad estable y el mismo cliente
(`scripts\ab-turn-closure.mjs`): `tools/call turn_ended` a mitad de sesión → el `drag` siguiente
**funciona**; hook nativo (`codex-computer-use.exe turn-ended`) a mitad de sesión → **funciona**; ambos
juntos → **funciona**; `js_reset` a mitad de sesión → **falla con `unknown screenshotId screenshot-0`**
(reinicia kernel y host de servicios, que se llevan por delante al helper y su registro). Conclusión: el
cierre es idempotente y no destructivo, `js_reset` no es un cierre sino una recuperación, y por eso el
agente no debe usar ninguno de los tres a mitad de tarea.

**Alcance del parche de metadatos.** El parche de `browser-service.mjs` evita el aborto de la guardia
(`Missing required Codex turn metadata`) pero **no** basta para cerrar un turno sin metadatos: las
lecturas internas del servicio siguen viendo el `requestMeta` del RPC. Por eso el camino recomendado en
clientes no-Codex es el puente (o el adaptador), que inyectan metadatos de verdad; `js_reset` no es un
cierre sino el último recurso para un helper muerto o atascado, una sola vez y al final.

---

## Marcadores de interrupción rancios (Escape)

`helper_transport.js` —el mismo módulo que gobierna la identidad de turno— escribe un fichero
**vacío** en

```text
<CODEX_HOME>\cache\computer-use\interrupts\<session_id>\<turn_id>
```

cuando el helper aborta porque el usuario pulsó **Escape**, y en **cada** `request` comprueba
`existsSync(esa ruta)` **antes** de hablar con el helper: si el fichero existe, rechaza la llamada con
`Computer Use was stopped by the user with the physical Escape key…` sin intentarlo. Nadie lo borra:
ni el helper, ni el runtime, ni el cierre de turno.

Consecuencia: si una ejecución nueva reutiliza la misma pareja (sesión, turno), el escritorio queda
bloqueado desde la primera llamada y solo se arregla borrando el fichero a mano. Es exactamente lo
que pasó aquí (`turn-15`, `turn-4`, `turn-8jk-…` bajo `…\interrupts\default-mcp-session\`): el shim
antiguo numeraba `turn-1`, `turn-2`… **desde cero en cada proceso**, así que el marcador de una sesión
anterior volvía a casar con la siguiente.

**Arreglo (v1.0.13):** el puente **borra al arrancar** los marcadores de su sesión
(`<CODEX_HOME>\cache\computer-use\interrupts\default-mcp-session\*`) y mantiene el `turn_id` con
sufijo aleatorio como segunda línea de defensa. Solo toca **su** carpeta: los marcadores de otras
sesiones (Codex, clientes que mandan sus propios ids) no se tocan y `doctor` solo los informa. Borrar
el fichero **no** desbloquea una sesión en curso: el transporte que ya rechazó una llamada mantiene el
bloqueo en memoria. `doctor` comprueba y limpia lo mismo, con **AVISO** (nunca FAIL).

**Evidencia A/B** (`scripts\ab-interrupt-markers.mjs`, informes en `%TEMP%\cu-ab\`), con un marcador
creado a mano en la sesión del puente y un cliente real por stdio con identidad fija:

| Paso | Qué se hace | Resultado medido |
| :-- | :-- | :-- |
| **A · antes** | Puente **sin** la limpieza (el instalado antes del arreglo) + marcador a mano | La celda 1 se rechaza: `Computer Use was stopped by the user with the physical Escape key…` |
| **B · después** | Puente del repo (con la limpieza) + el **mismo** marcador | Traza del puente: `limpiados 2 marcador(es) de interrupcion rancio(s)`; celda 1 observa Paint (`screenshot-0`), celda 2 dibuja (`sky.drag` OK) y la captura guardada lo confirma |
| **C · control** | El **mismo** proceso, marcador reescrito a mano, misma identidad | Vuelve a rechazarse con el mensaje de Escape: la causa es el fichero, no la limpieza |

En A había además un marcador **real** de una sesión anterior (`turn-8jk-s6bxqnoe`) y la limpieza de B
lo barrió junto con el de la prueba.

---

## Seguridad y Aislamiento

- **Control de procesos:** La lista blanca en `home/computer-use/config.toml` restringe los ejecutables sobre los cuales el motor puede interactuar.
- **Sin telemetría externa:** el modo offline desactiva la red ambiental; el único tráfico es el que
  genere la propia navegación del usuario.
- **Sesión real:** Interactúa con tus navegadores y ventanas locales existentes sin necesidad de exponer puertos remotos de depuración.
- **Sin tocar Codex:** el instalador usa su propio native host y su propia extensión; las claves y
  archivos de la app Codex nunca se modifican.
