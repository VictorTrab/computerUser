#!/usr/bin/env node
// ComputerUser MCP stdio bridge.
//
// QUE PROBLEMA RESUELVE
// El motor (`node_repl.exe`, rmcp 1.5.0) exige `initialize` como PRIMER mensaje.
// Cualquier cliente construido sobre el SDK de Go de MCP (`modelcontextprotocol/
// go_sdk`, protocolo `2026-07-28`) abre la tuberia con un sondeo `server/discover`
// para negociar version. `node_repl` no lo entiende, cierra la conexion (EOF) y el
// cliente marca el servidor como ERROR sin reintentar (Antigravity, Cursor). El SDK
// de Go solo hace *fallback* limpio a `initialize` si el servidor responde un error
// JSON-RPC `-32601` SIN cerrar stdio.
//
// Este puente, por tanto:
//   1. responde el `server/discover` con `-32601 Method not found` y NO se lo pasa
//      al hijo, de modo que el cliente renegocia con `initialize` sobre la MISMA
//      tuberia y el MISMO proceso;
//   2. inyecta `_meta["x-codex-turn-metadata"]` en cada `tools/call` cuando el
//      cliente no lo manda (los clientes no-Codex no lo mandan y `browser-service`
//      abortaria con "Missing required Codex turn metadata");
//   2b. NORMALIZA `turn_ended` (ver mas abajo): el cliente no-Codex no conoce los
//      identificadores de turno que inyecta este puente, y `browser-service` exige
//      que el `turn_id` del evento coincida con el del turno que acaba de correr
//      para soltar la sesion de navegador;
//   3. auto-responde `elicitation/create` del hijo con
//      `{"action":"accept","content":{"persist":"session"}}`, porque `sky-guard` ya
//      valida la allowlist y nadie va a dibujar el dialogo modal;
//   4. reenvia todo lo demas en ambos sentidos, sin interpretarlo.
//
// TURN_ID ESTABLE (medido; A/B con cliente real sobre stdio)
// Lo que rompe el escritorio no es que exista un `turn_id`, sino que CAMBIE entre
// llamadas. `helper_transport.js` (el transporte del helper nativo, la ruta
// `SKY_CUA_NATIVE_PIPE=0`) calcula una clave de turno
// (`Q(K(meta))` = codexHome/session/turn) y, en `R`, si la clave nueva difiere de la
// vigente, ANTES de la llamada manda `end_turn` del turno anterior al helper:
//
//     const i=Q(K(s)), r=this.d;                       // clave nueva / vigente
//     null!=r && r!==i && await T(helper,"end_turn",{},this.m);
//     this.d=i; this.m=s;
//
// `end_turn` cierra ese turno dentro de `codex-computer-use.exe`, que tira su registro
// de capturas: la siguiente accion por coordenadas falla con
// `unknown screenshotId screenshot-0` (el id por defecto de la captura) y el helper se
// reinicializa (overlay/cursor manager arrancados otra vez) con la latencia que eso
// cuesta. Eso es exactamente la regresion observada en Antigravity (app y CLI):
//
//   A puente con `turn-N` por llamada ......... drag -> "unknown screenshotId screenshot-0"
//   B mismo puente, identidad estable ......... drag -> OK
//   C node_repl.exe directo con `_meta` rotando drag -> "unknown screenshotId screenshot-0"
//   C node_repl.exe directo con `_meta` estable drag -> OK
//
// (C prueba que el culpable es la rotacion de ids, no el puente: el shim antiguo del
// usuario tambien rotaba `turn-<N>` por llamada y cae en lo mismo. DeepSeek Harness no
// manda `_meta`, la clave de turno es `null` y `R` nunca dispara `end_turn`: por eso
// ahi no se ve el fallo.)
//
// Por eso este puente sintetiza UNA identidad de turno y la mantiene durante toda la
// sesion del cliente (ver "MARCADORES DE INTERRUPCION" para el otro ingrediente: los
// ficheros de interrupcion rancios no los limpia nadie).
//
// MARCADORES DE INTERRUPCION RANCIOS (medido; A/B en scripts\ab-interrupt-markers.mjs)
// `helper_transport.js` (el mismo modulo del turno) escribe un fichero VACIO en
//
//     <CODEX_HOME>\cache\computer-use\interrupts\<session_id>\<turn_id>
//
// cuando el helper aborta porque el usuario pulso Escape (`U(turnScope)`), y en CADA
// `request` comprueba `existsSync(esa ruta)` ANTES de hablar con el helper:
//
//     if(null!=v&&function(t){const e=F(L,t);return r(e)}(v))
//       return t(this,y,w,"f"),Promise.reject(new Error(I));   // I = mensaje de Escape
//
// Es decir: si el fichero existe, TODA llamada con esa pareja (sesion, turno) se
// rechaza con "Computer Use was stopped by the user with the physical Escape key..."
// sin intentarlo siquiera. Y nadie lo borra: ni el helper, ni el runtime, ni el cierre
// de turno. Una sesion nueva que reutilice la misma pareja -el shim antiguo numeraba
// `turn-1`, `turn-2`... desde cero en cada proceso, y cualquier cliente que mande sus
// propios ids puede repetirlos- queda bloqueada desde la primera llamada, y solo se
// arregla borrando el fichero a mano. Eso es la intermitencia medida en Antigravity.
//
//   A puente sin limpieza + marcador puesto a mano ... rechazo inmediato (Escape)
//   B puente con limpieza + el mismo marcador ........ arranca limpio y dibuja
//   C mismo proceso, marcador reescrito .............. vuelve a rechazar (aisla la causa)
//
// El sufijo aleatorio del `turn_id` sintetico es la segunda linea de defensa: aunque la
// limpieza no llegara a correr (CODEX_HOME distinto, permisos), una sesion nueva no
// reutiliza el turno de la anterior y no puede reactivar su marcador.
//
// Por eso, al arrancar, el puente borra los marcadores de SU sesion
// (`<CODEX_HOME>\cache\computer-use\interrupts\<SYNTHETIC_SESSION_ID>\*`). Es seguro:
// son estado de una interrupcion YA ocurrida, no hay ninguna otra sesion viva que los
// consulte (el proceso acaba de empezar) y el transporte que ya rechazo una llamada
// mantiene su propio bloqueo en memoria, asi que borrar el fichero no desbloquea una
// sesion en curso. Solo se toca NUESTRA carpeta de sesion, nunca la de otro cliente.
//
// TURN_ENDED (medido)
// `tools/call turn_ended` es la senal de fin de turno: `node_repl` la reenvia a las
// librerias de confianza y `browser-service.mjs` (la unica que registra un handler)
// la usa para soltar la sesion de navegador. Ese handler compara el `turn_id` del
// EVENTO (los argumentos de la llamada) con el del turno vigente, asi que un
// `turn_ended` que llegue con un turno distinto NO suelta nada. Como el cliente no-Codex
// no puede conocer el `turn_id` sintetizado, se rellenan/ajustan `hook_event_name`,
// `session_id` y `turn_id` de los argumentos con el turno vigente.
//
// Cerrar NO rota la identidad: medido con el mismo cliente, `turn_ended` + hook nativo
// a mitad de sesion no invalidan las capturas (el drag siguiente sigue funcionando) y
// el mismo turno admite acciones despues del cierre. Mantener el id hace el cierre
// IDEMPOTENTE y sin efecto destructivo, que es lo que exige un cliente que cierre el
// turno varias veces o que siga trabajando despues. Lo unico que si destruye el estado
// es `js_reset` (reinicia kernel + host de servicios): es recuperacion, no cierre.
// Con metadatos propios del cliente (Codex, Cursor) no se toca absolutamente nada.
//
// FRAMING (decision documentada)
// El transporte "stdio" de MCP son mensajes JSON-RPC delimitados por salto de
// linea, y la especificacion PROHIBE que un mensaje contenga un `\n` sin escapar
// (uno de los motivos por los que el framing de Content-Length de LSP se retiro en
// la revision 2025-06-18). Se usa por tanto framing por linea, pero con un lector
// propio por BUFFERS (`createJsonlReader`) en vez de `readline`: `readline` esta
// pensado para terminales (emite `line` en cuanto ve `\n`, parte lineas y puede
// reordenar con `crlfDelay`), mientras que este lector acumula chunks y SOLO emite
// lineas completas, sin limite de tamano y sin decodificar a texto hasta tener la
// linea entera (una linea de varios MB -una captura en base64, por ejemplo- llega
// partida en muchos chunks y se reensambla integra).
//
// Uso: node mcp-bridge.mjs [args-de-node_repl...]
import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeDir = dirname(fileURLToPath(import.meta.url));

function log(message) {
  try {
    process.stderr.write(`[mcp-bridge] ${message}\n`);
  } catch {
    // stderr cerrado: no hay nada que hacer.
  }
}

// ---------------------------------------------------------------------------
// Resolucion del hijo.
// 1) `node_repl.exe` junto a este script (layout del release).
// 2) variable de entorno, para pruebas y layout alternativo.
// 3) `--bridge-repl <ruta>` como ultimo recurso.
// ---------------------------------------------------------------------------
function resolveReplPath() {
  const flagAt = process.argv.indexOf("--bridge-repl");
  if (flagAt !== -1 && process.argv[flagAt + 1]) {
    return process.argv[flagAt + 1];
  }
  if (process.env.MCP_BRIDGE_REPL && process.env.MCP_BRIDGE_REPL.trim()) {
    return process.env.MCP_BRIDGE_REPL.trim();
  }
  const candidates = [
    join(bridgeDir, "node_repl.exe"),
    join(bridgeDir, "..", "bin", "node_repl.exe"),
    join(bridgeDir, "..", "..", "runtime", "bin", "node_repl.exe"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// Argumentos para `node_repl`: todo lo que recibe el puente menos los nuestros.
const ourFlags = new Set(["--bridge-repl", "--bridge-log"]);
const replArgs = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (ourFlags.has(argv[i])) {
    i++; // y su valor
    continue;
  }
  replArgs.push(argv[i]);
}

const replPath = resolveReplPath();
if (!replPath) {
  log("no se encontro node_repl.exe junto al puente; usa MCP_BRIDGE_REPL o --bridge-repl");
  process.exit(2);
}

// Log opcional a fichero: util cuando el cliente se traga stderr.
const logAt = process.argv.indexOf("--bridge-log");
const logPath = logAt !== -1 && process.argv[logAt + 1] ? process.argv[logAt + 1] : null;
function trace(message) {
  if (!logPath) return;
  try {
    writeFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, { flag: "a" });
  } catch {
    // El log es diagnostico: si falla, no puede tumbar la sesion.
  }
}

log(`hijo: ${replPath} ${replArgs.join(" ")}`);
trace(`START bridge pid=${process.pid} ppid=${process.ppid} repl=${replPath} args=${JSON.stringify(replArgs)}`);

// ---------------------------------------------------------------------------
// Identidad de turno sintetica del puente + limpieza de marcadores rancios.
// Ver "TURN_ID ESTABLE" y "MARCADORES DE INTERRUPCION RANCIOS" en la cabecera.
// ---------------------------------------------------------------------------
// Una sola sesion logica para todo el puente: es la carpeta bajo
// `cache\computer-use\interrupts\` que este proceso limpia y la que usan los
// metadatos sinteticos y `turn_ended`.
const SYNTHETIC_SESSION_ID = "default-mcp-session";

// Mismo calculo que `helper_transport.js` (su `X()`): CODEX_HOME si esta definido y no
// vacio; si no, `%USERPROFILE%\.codex` en Windows y `~/.codex` en el resto.
function resolveCodexHome() {
  const fromEnv = (process.env.CODEX_HOME ?? "").trim();
  if (fromEnv) return fromEnv;
  const profile = (process.env.USERPROFILE ?? "").trim();
  if (process.platform === "win32" && profile) return join(profile, ".codex");
  return join(homedir(), ".codex");
}

// Carpeta de marcadores de interrupcion de NUESTRA sesion (nada mas).
function interruptSessionDir() {
  return join(resolveCodexHome(), "cache", "computer-use", "interrupts", SYNTHETIC_SESSION_ID);
}

// Borra los marcadores de interrupcion de esta sesion. Devuelve cuantos borro.
// Nunca lanza: si algo falla (permisos, ruta rara) se anota y el puente sigue; un
// marcador rancio es un estorbo, no un motivo para no arrancar.
function clearStaleInterruptMarkers() {
  const dir = interruptSessionDir();
  let entries;
  try {
    if (!existsSync(dir)) {
      trace(`marcadores de interrupcion: ${dir} no existe (nada que limpiar)`);
      return 0;
    }
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    log(`no se pudo leer ${dir}: ${err.message}`);
    trace(`marcadores de interrupcion: lectura fallida (${err.message})`);
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    // Solo ficheros (los marcadores son ficheros vacios); los directorios se respetan.
    if (!entry.isFile()) continue;
    try {
      rmSync(join(dir, entry.name), { force: true });
      removed++;
      trace(`marcador de interrupcion rancio borrado: ${SYNTHETIC_SESSION_ID}/${entry.name}`);
    } catch (err) {
      trace(`marcador de interrupcion NO borrado (${entry.name}): ${err.message}`);
    }
  }
  log(
    removed > 0
      ? `limpiados ${removed} marcador(es) de interrupcion rancio(s) de la sesion ${SYNTHETIC_SESSION_ID}`
      : `sin marcadores de interrupcion rancios en la sesion ${SYNTHETIC_SESSION_ID}`
  );
  return removed;
}

// Antes de lanzar el hijo: una interrupcion (Escape) de una ejecucion anterior no puede
// bloquear esta sesion.
clearStaleInterruptMarkers();

const child = spawn(replPath, replArgs, {
  // stderr se HEREDA (no se captura): si se pipea sin consumir, el buffer se llena
  // y el hijo se bloquea escribiendo trazas. Heredado va directo a la consola del
  // cliente, exactamente como si el cliente hubiera lanzado node_repl el mismo.
  stdio: ["pipe", "pipe", "inherit"],
  env: process.env,
  windowsHide: true,
});

let childExited = false;
let parentGone = false;
// `true` cuando SOMOS NOSOTROS los que pedimos al hijo que termine (el cliente cerro
// stdin o nos mataron). Distingue un apagado ordenado de una muerte real del motor,
// que es lo unico que debe propagarse como codigo de error.
let stoppingChild = false;

// EPIPE es NORMAL al cerrar: si el cliente se va o muere el hijo, la siguiente
// escritura falla. Sin estos manejadores, un `error` sin listener en un stream
// escribible TUMBA el proceso con codigo 1 (mismo sintoma que un fallo real).
child.stdin.on("error", () => {
  parentGone = true;
  killChild();
});
process.stdout.on("error", () => {
  parentGone = true;
  killChild();
});

// ---------------------------------------------------------------------------
// Lector de lineas JSON sin `readline` y sin trocear mensajes.
// ---------------------------------------------------------------------------
function createJsonlReader(readable, onMessage, label) {
  let chunks = [];
  let pending = 0;
  return readable.on("data", (chunk) => {
    chunks.push(chunk);
    pending += chunk.length;
    for (;;) {
      // `Buffer.concat` de TODOS los chunks pendientes: nunca se pierde una linea
      // grande aunque el emisor la parta en trozos arbitrarios.
      const buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, pending);
      const nl = buf.indexOf(0x0a);
      if (nl === -1) {
        chunks = [buf];
        pending = buf.length;
        return;
      }
      // `toString` sobre la linea ya completa: una secuencia UTF-8 multibyte
      // jamas queda partida entre dos chunks.
      const line = buf.subarray(0, nl).toString("utf8").trim();
      const rest = buf.subarray(nl + 1);
      chunks = rest.length ? [rest] : [];
      pending = rest.length;
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (err) {
        // No es JSON: se reenvia tal cual (el cliente decidira) y se anota.
        trace(`${label} linea no-JSON (${err.message}): ${line.slice(0, 200)}`);
        onMessage(null, line);
        continue;
      }
      onMessage(msg, line);
    }
  });
}

function writeToChild(obj) {
  if (childExited || !child.stdin || child.stdin.destroyed) return false;
  try {
    return child.stdin.write(JSON.stringify(obj) + "\n");
  } catch (err) {
    trace(`escritura al hijo fallida: ${err.message}`);
    return false;
  }
}

function writeToClient(obj) {
  try {
    return process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (err) {
    trace(`escritura al cliente fallida: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sentido CLIENTE -> HIJO
// ---------------------------------------------------------------------------
let sawDiscover = false;
let sawInitialize = false;
// Identidad de turno sintetica: UNA sola por proceso del puente (ver "TURN_ID
// ESTABLE" arriba). `turn_ended` la reutiliza, de modo que el evento y el turno
// vigente casan siempre y el cierre es idempotente. El `session_id` es
// `SYNTHETIC_SESSION_ID` (definido arriba, junto a la limpieza de marcadores).
let syntheticTurn = null;

function syntheticTurnMetadata() {
  if (!syntheticTurn) {
    const entropy = Math.random().toString(36).slice(2, 10);
    syntheticTurn = {
      session_id: SYNTHETIC_SESSION_ID,
      turn_id: `turn-${process.pid.toString(36)}-${entropy}`,
      thread_source: "user",
    };
  }
  return syntheticTurn;
}

const TURN_ENDED_TOOL = "turn_ended";

// Los argumentos de `turn_ended` son los que viajan como EVENTO a las librerias de
// confianza: `hook_event_name`, `session_id` y `turn_id`. `node_repl` rechaza la
// llamada si alguno esta vacio ("turn_ended requires non-empty event, session, and
// turn IDs"), asi que aqui se rellenan con el turno que el puente conoce.
function normalizeTurnEndedArguments(args, turn) {
  const out = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  if (typeof out.hook_event_name !== "string" || out.hook_event_name.trim() === "") {
    out.hook_event_name = "Stop";
  }
  if (typeof out.session_id !== "string" || out.session_id.trim() === "") {
    out.session_id = turn.session_id;
  }
  if (typeof out.turn_id !== "string" || out.turn_id.trim() === "") {
    out.turn_id = turn.turn_id;
  }
  // Un cliente no-Codex no puede conocer el `turn_id` sintetizado: si manda otro,
  // mandan los del turno vigente. Sin esto el handler de `browser-service` no
  // reconoce el turno y no suelta la sesion. El id sintetizado es estable durante
  // toda la sesion, asi que cerrar dos veces es inofensivo.
  if (out.session_id !== turn.session_id) {
    trace(`turn_ended: session_id del cliente (${out.session_id}) sustituido por el del turno (${turn.session_id})`);
    out.session_id = turn.session_id;
  }
  if (out.turn_id !== turn.turn_id) {
    trace(`turn_ended: turn_id del cliente (${out.turn_id}) sustituido por el del turno (${turn.turn_id})`);
    out.turn_id = turn.turn_id;
  }
  return out;
}

createJsonlReader(
  process.stdin,
  (msg, rawLine) => {
    if (!msg) {
      // Linea no-JSON del cliente: no hay nada que interceptar.
      if (child.stdin && !child.stdin.destroyed) child.stdin.write(rawLine + "\n");
      return;
    }

    // 1. Sondeo de negociacion de version del SDK de Go (protocolo 2026-07-28).
    //    Se responde aqui y NO se reenvia: node_repl cerraria la conexion.
    if (msg.method === "server/discover") {
      sawDiscover = true;
      trace(`CLIENTE->PUENTE server/discover id=${JSON.stringify(msg.id)} -> -32601`);
      writeToClient({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: "Method not found: server/discover" },
      });
      return;
    }

    if (msg.method === "initialize") sawInitialize = true;

    // 2. Metadatos de turno por defecto para clientes que no son Codex.
    if (msg.method === "tools/call" && msg.params && typeof msg.params === "object") {
      const meta =
        msg.params._meta && typeof msg.params._meta === "object" && !Array.isArray(msg.params._meta)
          ? msg.params._meta
          : (msg.params._meta = {});
      const clientProvidedMeta = meta["x-codex-turn-metadata"] != null;
      if (!clientProvidedMeta) {
        const toolName = msg.params.name;
        // La MISMA identidad para toda la sesion del cliente: un `turn_id` nuevo por
        // llamada hace que el helper cierre el turno anterior en cada `tools/call`
        // (`end_turn`), lo que tira su registro de capturas ("unknown screenshotId")
        // y reinicializa el overlay. Ver "TURN_ID ESTABLE" arriba.
        const turn = syntheticTurnMetadata();
        meta["x-codex-turn-metadata"] = JSON.stringify(turn);
        if (toolName === TURN_ENDED_TOOL) {
          msg.params.arguments = normalizeTurnEndedArguments(msg.params.arguments, turn);
          trace(`turn_ended normalizado al turno vigente ${turn.session_id}/${turn.turn_id}`);
        } else {
          trace(`inyectado x-codex-turn-metadata en tools/call (${toolName ?? "?"}) -> ${turn.turn_id}`);
        }
      } else if (msg.params.name === TURN_ENDED_TOOL) {
        // Cliente con metadatos propios (Codex): se respeta lo que manda, pero se
        // rellenan los argumentos vacios para que `node_repl` no rechace la llamada.
        const parsed = (() => {
          try {
            return JSON.parse(meta["x-codex-turn-metadata"]);
          } catch {
            return null;
          }
        })();
        if (parsed && typeof parsed === "object") {
          msg.params.arguments = normalizeTurnEndedArguments(msg.params.arguments, parsed);
        }
      }
    }

    if (!child.stdin || child.stdin.destroyed) return;
    // Se reescribe la linea SIEMPRE (no solo cuando se inyecta): asi el mensaje
    // reenviado es exactamente el objeto que el puente decidio, sin depender de
    // como lo formateo el cliente.
    child.stdin.write(JSON.stringify(msg) + "\n");
  },
  "CLIENTE"
);

// ---------------------------------------------------------------------------
// Sentido HIJO -> CLIENTE
// ---------------------------------------------------------------------------
// Respuestas por defecto a peticiones que el hijo hace AL CLIENTE y que un cliente
// no-Codex no sabe atender. Sin respuesta, la llamada se queda colgada.
const DEFAULT_SERVER_REQUESTS = {
  "elicitation/create": { action: "accept", content: { persist: "session" } },
  "sampling/createMessage": { role: "assistant", content: { type: "text", text: "" }, model: "mcp-bridge" },
  "roots/list": { roots: [] },
  ping: {},
};

createJsonlReader(
  child.stdout,
  (msg, rawLine) => {
    if (!msg) {
      if (!parentGone) process.stdout.write(rawLine + "\n");
      return;
    }

    // Peticion del servidor al cliente (lleva `id` y `method`). `elicitation/create`
    // es la que pide aprobacion para usar una app/navegador: sky-guard ya valido la
    // allowlist, asi que se acepta y se persiste en la sesion para no repetirla.
    if (msg.id !== undefined && msg.method !== undefined) {
      const canned = Object.prototype.hasOwnProperty.call(DEFAULT_SERVER_REQUESTS, msg.method)
        ? DEFAULT_SERVER_REQUESTS[msg.method]
        : undefined;
      if (canned !== undefined) {
        trace(`HIJO->PUENTE ${msg.method} id=${JSON.stringify(msg.id)} -> auto-respuesta`);
        writeToChild({ jsonrpc: "2.0", id: msg.id, result: canned });
        return;
      }
      trace(`HIJO->PUENTE ${msg.method} id=${JSON.stringify(msg.id)} -> reenviado al cliente`);
    }

    if (!parentGone) process.stdout.write(JSON.stringify(msg) + "\n");
  },
  "HIJO"
);

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------
let exiting = false;
function exitWith(code) {
  if (exiting) return;
  exiting = true;
  // `process.exit()` con datos aun encolados en stdout los PIERDE (en Windows las
  // tuberias escriben de forma asincrona), y la ultima respuesta del hijo es justo
  // la que importa. Por eso NO se sale a lo bruto: se fija `exitCode`, se suelta
  // stdin y el child, y se deja que Node vacie stdout y termine solo.
  process.exitCode = code;
  try {
    process.stdin.destroy();
  } catch {
    // stdin ya cerrado
  }
  try {
    child.unref();
  } catch {
    // el hijo ya no existe
  }
}

child.on("error", (err) => {
  log(`no se pudo lanzar el hijo: ${err.message}`);
  trace(`ERROR spawn: ${err.message}`);
  exitWith(1);
});

child.on("exit", (code, signal) => {
  childExited = true;
  trace(`HIJO salio code=${code} signal=${signal} ordenado=${stoppingChild}`);
  // Salida ordenada (nosotros pedimos el fin): 0. Muerte inesperada: el codigo del
  // hijo, o 1 si murio por señal (mismo criterio que la convencion de shell).
  if (stoppingChild) exitWith(0);
  else exitWith(code == null ? (signal ? 1 : 0) : code);
});

// El cliente cerro stdin (se fue): no tiene sentido dejar el motor vivo.
process.stdin.on("end", () => {
  parentGone = true;
  trace("stdin del cliente cerrado -> matando el hijo");
  killChild();
});
process.stdin.on("error", () => {
  parentGone = true;
  killChild();
});

function killChild() {
  if (childExited) return;
  stoppingChild = true;
  try {
    child.kill();
  } catch {
    // ya estaba muerto
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  try {
    process.on(signal, () => {
      parentGone = true;
      killChild();
      exitWith(0);
    });
  } catch {
    // Señal no soportada en esta plataforma.
  }
}

process.on("exit", () => {
  // Ultimo seguro: si el puente muere por cualquier motivo, el motor no queda huerfano.
  killChild();
});

trace(`inicializado (sawDiscover pendiente; initialize=${sawInitialize})`);
