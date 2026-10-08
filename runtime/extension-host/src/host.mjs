#!/usr/bin/env node
// ---------------------------------------------------------------------------
// ComputerUser native messaging host.
//
// Sustituye al `extension-host.exe` de Codex. Es un host de *native messaging*
// completo: habla el framing `uint32LE + UTF-8 JSON` con el navegador por stdio,
// CREA el named pipe `\\.\pipe\codex-browser-use\<uuid4>` que espera el runtime
// y hace de puente JSON-RPC 2.0 entre los dos.
//
//   extension del navegador  --(stdio, uint32LE + JSON)-->  ESTE HOST
//   ESTE HOST                <--(named pipe, uint32LE + JSON)-->  node_repl.exe
//
// Se lanza SIEMPRE a traves del lanzador nativo `windows\x64\extension-host.exe`
// (el navegador necesita una imagen ejecutable), que resuelve rutas relativas a
// su propio .exe:
//
//   node <runtime>\extension-host\src\host.mjs "chrome-extension://<id>/" --parent-window=<n>
//
// Especificacion del protocolo y evidencia: `HOST-PROPIO-SPEC.md` en el repo de
// desarrollo (todo el comportamiento se dedujo del binario de Codex y se
// verifico con la extension real en Chrome y Brave).
//
// Flags opcionales (para diagnostico; el navegador no las pasa):
//     --pipe-name=\\.\pipe\codex-browser-use\<uuid>   forzar el nombre del pipe
//     --trace=<fichero.jsonl>                        traza de protocolo
//     --id-rewrite=on|off                            namespacing de ids JSON-RPC
//     --instances=<n>                                instancias extra del pipe
//     --quiet                                        menos traza en stderr
// ---------------------------------------------------------------------------
import { randomUUID } from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { encodeFrame, createFrameDecoder } from "./framing.mjs";
import { createTrace } from "./trace.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST_ROOT = resolve(HERE, "..");

// El host real lleva este prefijo hard-coded (constante Rust, 29 bytes:
// "\\.\pipe\codex-browser-use") y le añade "\" + uuid4 en runtime.
// Verificado empiricamente: lanzar extension-host.exe hace aparecer exactamente
// una entrada `codex-browser-use\<uuid>` en \\.\pipe\ .
const PIPE_PREFIX = "\\\\.\\pipe\\codex-browser-use\\";

function parseArgv(argv) {
  const opts = {
    origin: null,
    parentWindow: null,
    pipeName: null,
    trace: null,
    idRewrite: true,
    instances: 1,
    quiet: false,
    replyUnknown: false,
    raw: argv.slice(),
  };
  const rest = [];
  for (const a of argv) {
    if (a.startsWith("--parent-window=")) opts.parentWindow = a.slice("--parent-window=".length);
    else if (a.startsWith("--pipe-name=")) opts.pipeName = a.slice("--pipe-name=".length);
    else if (a.startsWith("--trace=")) opts.trace = a.slice("--trace=".length);
    else if (a.startsWith("--instances=")) opts.instances = Number(a.slice("--instances=".length)) || 1;
    else if (a === "--id-rewrite=off") opts.idRewrite = false;
    else if (a === "--id-rewrite=on") opts.idRewrite = true;
    else if (a === "--quiet") opts.quiet = true;
    else if (a === "--reply-unknown=on") opts.replyUnknown = true;
    else rest.push(a);
  }
  opts.origin = rest[0] ?? null;
  opts.extra = rest.slice(1);
  return opts;
}

const opts = parseArgv(process.argv.slice(2));
const pipeName = opts.pipeName ?? process.env.CU_HOST_PIPE_NAME ?? process.env.PROTO_PIPE_NAME ?? PIPE_PREFIX + randomUUID();
const tracePath =
  opts.trace ??
  process.env.CU_HOST_TRACE ??
  process.env.PROTO_TRACE ??
  join(HOST_ROOT, "logs", `host-${process.pid}.jsonl`);
const trace = createTrace(tracePath);

const log = (...args) => {
  if (!opts.quiet) process.stderr.write("[cu-host] " + args.join(" ") + "\n");
};

log(`pid=${process.pid}`);
log(`argv=${JSON.stringify(process.argv.slice(2))}`);
log(`origin=${opts.origin}`);
log(`parent-window=${opts.parentWindow}`);
log(`pipe=${pipeName}`);
log(`trace=${tracePath}`);
log(`idRewrite=${opts.idRewrite} instances=${opts.instances}`);
log(`CODEX_HOME=${process.env.CODEX_HOME ?? "(unset)"}`);
log(
  `CODEX_NODE_REPL_PATH=${process.env.CODEX_NODE_REPL_PATH ?? "(unset)"} ` +
    `CODEX_BROWSER_CLIENT_PATH=${process.env.CODEX_BROWSER_CLIENT_PATH ?? "(unset)"} ` +
    `CODEX_BROWSER_USE_NODE_PATH=${process.env.CODEX_BROWSER_USE_NODE_PATH ?? "(unset)"} ` +
    `CODEX_CLI_PATH=${process.env.CODEX_CLI_PATH ?? "(unset)"} ` +
    `CODEX_EXTENSION_ID=${process.env.CODEX_EXTENSION_ID ?? "(unset)"}`,
);
trace.log("note", { event: "start", pid: process.pid, argv: process.argv.slice(2), pipeName });

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
/** @type {Map<number, {id:number, socket:net.Socket, label:string}>} */
const clients = new Map();
let nextClientId = 1;
let browserClosed = false;

// Namespacing de ids JSON-RPC. El runtime numera sus peticiones 1,2,3…, y el
// peer de la extension tambien, asi que con mas de un cliente del pipe un id
// crudo ya no se puede enrutar sin ambiguedad.
//
// El host real hace exactamente esto y el esquema se leyo del cable durante la
// ejecucion A/B de baseline (--host=real):
//     getInfo     id="native-host:1:1"
//     getTabs     id="native-host:1:2"
//     getUserTabs id="native-host:1:3"
//     nameSession id="native-host:1:4"
// es decir `native-host:<indiceCliente>:<idOriginal>`, indice desde 1.
// Ojo: esto NO coincide a proposito con la forma de id del transporte de la
// propia extension (`/^native-host:\d+$/`, background.js: Sg/Tg), asi que la
// extension sigue enrutando esas respuestas a su peer JSON-RPC y no a su
// NativeTransport.
let rewriteCount = 0;
/** @type {Map<string, {clientId:number|"broadcast", originalId:unknown}>} */
const routeById = new Map();

const ID_REWRITE_PREFIX = "native-host:";
const LOCAL_REQUEST_ID = /^native-host:\d+$/;

const sendToBrowser = (jsonTextOrObject) => {
  if (browserClosed) return;
  try {
    process.stdout.write(encodeFrame(jsonTextOrObject));
  } catch (err) {
    log(`stdout write failed: ${err.message}`);
    process.exit(0);
  }
};

const sendJsonToClient = (client, obj) => {
  try {
    client.socket.write(encodeFrame(obj));
  } catch (err) {
    log(`pipe write to client#${client.id} failed: ${err.message}`);
  }
};

const broadcastToClients = (obj) => {
  for (const client of clients.values()) sendJsonToClient(client, obj);
};

// ---------------------------------------------------------------------------
// Pipe server
// ---------------------------------------------------------------------------
const servers = [];
let boundCount = 0;

for (let i = 0; i < Math.max(1, opts.instances); i++) {
  const server = net.createServer((socket) => {
    const id = nextClientId++;
    const client = { id, socket, label: `client#${id}` };
    clients.set(id, client);
    socket.setNoDelay(true);
    log(`pipe client#${id} connected (total=${clients.size})`);
    trace.log("note", { event: "pipe-client-connected", client: id, total: clients.size });

    const decoder = createFrameDecoder();
    socket.on("data", (chunk) => {
      let texts;
      try {
        texts = decoder.push(chunk);
      } catch (err) {
        log(`client#${id} framing error: ${err.message}`);
        trace.log("note", { event: "pipe-framing-error", client: id, message: err.message });
        socket.destroy();
        return;
      }
      for (const text of texts) {
        trace.log("pipe->host", text);
        let msg;
        try {
          msg = JSON.parse(text);
        } catch {
          log(`client#${id} sent non-JSON frame, dropped`);
          trace.log("note", { event: "pipe-non-json", client: id });
          continue;
        }
        relayClientToBrowser(client, msg);
      }
    });
    const drop = (why) => {
      if (!clients.has(id)) return;
      clients.delete(id);
      for (const [wire, route] of routeById) if (route.clientId === id) routeById.delete(wire);
      log(`pipe client#${id} disconnected (${why}, total=${clients.size})`);
      trace.log("note", { event: "pipe-client-disconnected", client: id, why, total: clients.size });
    };
    socket.on("close", () => drop("close"));
    socket.on("error", (err) => drop("error: " + err.message));
  });

  server.on("error", (err) => {
    log(`pipe server error: ${err.code ?? ""} ${err.message}`);
    trace.log("note", { event: "pipe-server-error", message: err.message, code: err.code });
    if (boundCount === 0) process.exit(3);
  });

  server.listen(pipeName, () => {
    boundCount++;
    log(`pipe listening on ${pipeName} (instance ${boundCount})`);
    trace.log("note", { event: "pipe-listening", pipeName, instance: boundCount });
  });
  servers.push(server);
}

// ---------------------------------------------------------------------------
// Relay: pipe client -> browser extension
// ---------------------------------------------------------------------------
function relayClientToBrowser(client, msg) {
  if (msg != null && typeof msg === "object" && typeof msg.method === "string") {
    // Peticion o notificacion originada por el runtime.
    if (msg.id !== undefined && opts.idRewrite) {
      const wire = `${ID_REWRITE_PREFIX}${client.id}:${String(msg.id)}`;
      routeById.set(wire, { clientId: client.id, originalId: msg.id });
      rewriteCount++;
      sendToBrowser({ ...msg, id: wire });
    } else {
      sendToBrowser(msg);
    }
    return;
  }
  // Si no, es una respuesta del runtime a una peticion de la extension.
  sendToBrowser(msg);
}

// ---------------------------------------------------------------------------
// Relay: browser extension -> pipe clients
// ---------------------------------------------------------------------------
const decoder = createFrameDecoder();
process.stdin.on("data", (chunk) => {
  let texts;
  try {
    texts = decoder.push(chunk);
  } catch (err) {
    log(`stdin framing error: ${err.message}; exiting`);
    process.exit(2);
  }
  for (const text of texts) {
    trace.log("browser->host", text);
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      log("extension sent non-JSON frame, dropped");
      continue;
    }
    dispatchFromBrowser(msg);
  }
});

process.stdin.on("end", () => {
  browserClosed = true;
  log("stdin closed (extension/browser went away); exiting");
  trace.log("note", { event: "stdin-closed" });
  shutdown(0);
});
process.stdin.on("error", (err) => {
  log(`stdin read failed: ${err.message}; exiting`);
  shutdown(0);
});

// ---------------------------------------------------------------------------
// Vigilancia del padre: el hijo no puede quedar huerfano
// ---------------------------------------------------------------------------
// El lanzador nativo (`windows\x64\extension-host.exe`) aisla a este proceso en
// un Job Object con JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, de modo que matar el
// lanzador mata al hijo aunque el navegador siga vivo (si el navegador mantiene
// el pipe abierto, stdin NO da EOF: verificado, el hijo sobrevivia sirviendo el
// pipe indefinidamente). Esta vigilancia cubre ademas el caso de un lanzador
// antiguo (sin Job Object): cuando desaparece el proceso padre, salimos.
//
// `process.kill(ppid, 0)` es la unica via portable desde node para preguntar si
// un pid sigue vivo en Windows; solo actuamos ante ESRCH (proceso inexistente)
// para no matar un host legitimo por un error de permisos.
const watchParent = process.env.CU_HOST_WATCH_PARENT !== "0";
const parentPid = process.ppid;
if (watchParent && Number.isInteger(parentPid) && parentPid > 0) {
  const timer = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch (err) {
      if (err && err.code === "ESRCH") {
        log(`parent process ${parentPid} is gone; exiting`);
        trace.log("note", { event: "parent-gone", ppid: parentPid });
        shutdown(0);
      }
    }
  }, 300);
  if (typeof timer.unref === "function") timer.unref();
  log(`watching parent pid=${parentPid}`);
  trace.log("note", { event: "watch-parent", ppid: parentPid });
}

function dispatchFromBrowser(msg) {
  const isResponseLike =
    msg != null && typeof msg === "object" && !("method" in msg) && msg.id !== undefined;

  if (isResponseLike) {
    const route = opts.idRewrite ? routeById.get(String(msg.id)) : undefined;
    if (route) {
      routeById.delete(String(msg.id));
      const client = clients.get(route.clientId);
      if (client) {
        const out = { ...msg, id: route.originalId };
        trace.log("host->pipe", JSON.stringify(out));
        sendJsonToClient(client, out);
        return;
      }
      log(`response for a gone client dropped (id=${msg.id})`);
      return;
    }
    // Respuesta no rastreada: broadcast (caso de un solo cliente / pass-through).
    trace.log("host->pipe", text0(msg));
    broadcastToClients(msg);
    return;
  }

  // Peticion de la extension al host. Los ids `native-host:NN` son el namespace
  // del transporte de la propia extension y los responde el host (en el host
  // real: el proxy del app-server de Codex). Todo lo demas va al runtime.
  if (typeof msg?.method === "string" && typeof msg.id === "string" && LOCAL_REQUEST_ID.test(msg.id)) {
    handleHostLocalRequest(msg);
    return;
  }

  if (typeof msg?.method === "string" && msg.id === undefined) {
    trace.log("host->pipe", text0(msg));
    broadcastToClients(msg);
    return;
  }

  trace.log("host->pipe", text0(msg));
  broadcastToClients(msg);
}

const text0 = (o) => JSON.stringify(o);

// ---------------------------------------------------------------------------
// Namespace host-local: codexRuntime/*
// ---------------------------------------------------------------------------
// La extension real pide al host (no al runtime):
//   codexRuntime/hello, /ensure, /restart, /openLocalFile, /tabContextAsset/*
// Validacion que hace la extension (background.js, Xv):
//   manifestSchemaVersion === 2 &&
//   nativeHostProtocolVersion === constraints.requiredNativeHostProtocolVersion &&
//   supportedProtocolVersions.includes(constraints.requiredNativeHostProtocolVersion)
//
// Los valores de abajo son los que devolvio de verdad el extension-host.exe de
// Codex al sondearlo con tools/probe-host-local-rpc.mjs --host=real:
//   {"manifestSchemaVersion":2,"nativeHostProtocolVersion":2,
//    "nativeHostVersion":"0.1.0","supportedMethods":["codexRuntime/openLocalFile"],
//    "supportedProtocolVersions":[2]}
const NATIVE_HOST_PROTOCOL_VERSION = 2;
const MANIFEST_SCHEMA_VERSION = 2;
const NATIVE_HOST_VERSION = "1.0.10";
const SUPPORTED_METHODS = ["codexRuntime/openLocalFile"];

function handleHostLocalRequest(msg) {
  if (msg.method === "codexRuntime/hello") {
    const result = {
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      nativeHostProtocolVersion: NATIVE_HOST_PROTOCOL_VERSION,
      nativeHostVersion: NATIVE_HOST_VERSION,
      supportedMethods: SUPPORTED_METHODS,
      supportedProtocolVersions: [NATIVE_HOST_PROTOCOL_VERSION],
    };
    log(`local ${msg.method} -> ${JSON.stringify(result)}`);
    trace.log("host:local", JSON.stringify({ request: msg, response: result }));
    sendToBrowser({ jsonrpc: "2.0", id: msg.id, result });
    return;
  }

  if (msg.method === "codexRuntime/ensure" || msg.method === "codexRuntime/restart") {
    // El host real arranca / se engancha aqui al app-server de Codex y responde
    // con su URL + el id de sesion del runtime. Este host NO implementa el proxy
    // al app-server, asi que reproduce la forma de fallo del host real:
    //   {"error":{"code":1,"data":{"type":"no_matching_codex_install"},
    //             "message":"No compatible Codex app-server entry was found"}}
    // Consecuencia conocida y documentada: el sidepanel de Codex no arranca.
    const response = {
      jsonrpc: "2.0",
      id: msg.id,
      error: {
        code: 1,
        message: "No compatible Codex app-server entry was found",
        data: { type: "no_matching_codex_install" },
      },
    };
    log(`local ${msg.method} -> no_matching_codex_install`);
    trace.log("host:local", JSON.stringify({ request: msg, response }));
    sendToBrowser(response);
    return;
  }

  // Observado en el host real: un metodo `native-host:*` desconocido NO produce
  // ninguna respuesta (se descarta, no se contesta con error JSON-RPC).
  log(`local ${msg.method} -> dropped (no reply, matches real host)`);
  trace.log("host:local", JSON.stringify({ request: msg, response: null, note: "dropped" }));
  if (opts.replyUnknown) {
    sendToBrowser({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -1, message: `No handler registered for method: ${msg.method}` },
    });
  }
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------
let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  trace.log("note", { event: "shutdown", code });
  for (const server of servers) {
    try {
      server.close();
    } catch {}
  }
  for (const client of clients.values()) {
    try {
      client.socket.destroy();
    } catch {}
  }
  setTimeout(() => process.exit(code), 20).unref?.();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
