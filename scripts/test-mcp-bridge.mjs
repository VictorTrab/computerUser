// Prueba directa del puente MCP stdio, SIN Antigravity ni ningun otro cliente.
//
// Habla con `runtime/bin/mcp-bridge.mjs` exactamente como lo hace un cliente
// basado en el SDK de Go de MCP (el que usa Antigravity / Cursor):
//
//   1. `server/discover`            -> DEBE responder -32601 sin cerrar stdio
//   2. `initialize`                 -> DEBE responder el result de rmcp 1.5.0
//   3. `tools/list`                 -> DEBE exponer js / js_add_node_module_dir
//                                      / js_reset / turn_ended
//   4. `tools/call` de `js`         -> SIN enviar `x-codex-turn-metadata`
//                                      (el puente lo inyecta y browser-service ya
//                                      no aborta por metadatos ausentes)
//
// Uso:
//   node scripts/test-mcp-bridge.mjs [InstallDir] [--fast|--full]
//     --fast  (por defecto) solo el handshake y tools/list
//     --full  ademas ejecuta list_apps y listBrowsers por `js`
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const mode = argv.includes("--full") ? "full" : "fast";
const installArg = argv.find((a) => !a.startsWith("--"));
const installDir = resolve(installArg ?? process.cwd());

const binDir = join(installDir, "runtime", "bin");
const browserDir = join(installDir, "runtime", "browser");
const homeDir = join(installDir, "home");
const nodeExe = join(binDir, "node.exe");
const bridge = join(binDir, "mcp-bridge.mjs");
const replExe = join(binDir, "node_repl.exe");

const failures = [];
const ok = (m) => console.log("  [OK] " + m);
const fail = (m) => {
  failures.push(m);
  console.log("  [FAIL] " + m);
};

for (const [label, path] of [
  ["node.exe", nodeExe],
  ["node_repl.exe", replExe],
  ["mcp-bridge.mjs", bridge],
]) {
  if (existsSync(path)) ok(label + " presente");
  else fail(label + " ausente: " + path);
}
if (failures.length) {
  console.log("\nPrueba abortada: faltan componentes.");
  process.exit(1);
}

const nodeModules = join(binDir, "node_modules");
// Traza del puente: es la prueba de que `turn_ended` se normaliza al turno vigente.
const bridgeLog = join(tmpdir(), `cu-bridge-test-${process.pid}.log`);
try {
  rmSync(bridgeLog, { force: true });
} catch {}
const bridgeProc = spawn(nodeExe, [bridge, "--disable-sandbox", "--bridge-log", bridgeLog], {
  env: {
    ...process.env,
    CODEX_HOME: homeDir,
    NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS: "1000",
    NODE_REPL_NODE_MODULE_DIRS: nodeModules,
    NODE_REPL_NODE_PATH: nodeExe,
    NODE_REPL_TRUSTED_CODE_PATHS: [homeDir, nodeModules, browserDir].join(";"),
    NODE_REPL_TRUSTED_SERVICES: JSON.stringify({
      browser: join(browserDir, "browser-service.mjs").replace(/\\/g, "/"),
      sky: "@computer-user/sky-guard",
    }),
    SKY_CUA_NATIVE_PIPE: "0",
    BROWSER_USE_AVAILABLE_BACKENDS: "chrome,iab",
    BROWSER_USE_TINYSKY_ENABLED: "1",
    BROWSER_USE_SECURITY_MODE: "disabled-for-local-testing",
    BROWSER_USE_FULL_CDP_ACCESS_ENABLED: "1",
    BROWSER_USE_DISABLE_AMBIENT_NETWORK: "1",
    BROWSER_USE_CODEX_APP_BUILD_FLAVOR: "prod",
    BROWSER_USE_CODEX_APP_VERSION: "26.915.31945",
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let childErr = "";
bridgeProc.stderr.on("data", (d) => (childErr += d.toString()));
bridgeProc.on("exit", (code, signal) => {
  if (code !== 0 && code !== null) console.log(`  (el puente salio code=${code} signal=${signal})`);
});

let rx = Buffer.alloc(0);
const pending = new Map();
bridgeProc.stdout.on("data", (chunk) => {
  rx = Buffer.concat([rx, chunk]);
  for (;;) {
    const nl = rx.indexOf(0x0a);
    if (nl === -1) return;
    const line = rx.subarray(0, nl).toString("utf8").trim();
    rx = rx.subarray(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      entry.resolve(msg);
    }
  }
});

let nextId = 1;
function rpc(method, params, { timeoutMs = 60000, meta } = {}) {
  return new Promise((resolvePromise) => {
    const id = nextId++;
    const payload = { jsonrpc: "2.0", id, method };
    if (params !== undefined) payload.params = params;
    if (meta) {
      payload.params = payload.params ?? {};
      payload.params._meta = meta;
    }
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolvePromise({ timeout: true, id, method });
      }
    }, timeoutMs);
    pending.set(id, { resolve: resolvePromise, timer });
    bridgeProc.stdin.write(JSON.stringify(payload) + "\n");
  });
}

function notify(method, params) {
  bridgeProc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

// El kernel de node_repl puede anteponer avisos ("Warning: out was declared with
// const...") al texto que escribio el script. Se extrae el ULTIMO objeto JSON
// balanceado del texto, que es la carga util real.
function extractPayload(result) {
  const text = (result?.content ?? [])
    .filter((c) => c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  const start = text.indexOf("{");
  if (start === -1) return text.trim();
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start).trim();
}

const cleanup = () => {
  try {
    bridgeProc.stdin.end();
  } catch {}
  setTimeout(() => {
    try {
      bridgeProc.kill();
    } catch {}
  }, 300);
};

// Lee la traza del puente (puede no existir todavia: se reintenta).
function readBridgeLog() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const text = readFileSync(bridgeLog, "utf8");
      if (text.trim()) return text;
    } catch {}
    // Espera bloqueante corta: la traza se escribe antes de reenviar al hijo.
    const until = Date.now() + 50;
    while (Date.now() < until) {
      /* spin */
    }
  }
  return "";
}

// Identificadores de turno que el puente inyecta en la llamada (visibles para el
// codigo del kernel por `nodeRepl.requestMeta`).
const READ_TURN_META = `
let out = { step: "turn-meta" };
try { out.meta = JSON.parse(nodeRepl.requestMeta?.["x-codex-turn-metadata"] ?? "null"); }
catch (e) { out.error = String(e && e.message); }
nodeRepl.write(JSON.stringify(out));
`;

console.log("\n== 1. server/discover (sondeo del SDK de Go) ==");
const discover = await rpc("server/discover", {}, { timeoutMs: 15000 });
console.log("  crudo: " + JSON.stringify(discover));
if (discover.timeout) fail("server/discover no obtuvo respuesta (el puente no lo intercepto)");
else if (discover.error?.code === -32601) ok("respondio -32601 Method not found (fallback limpio)");
else fail("respuesta inesperada a server/discover: " + JSON.stringify(discover));

console.log("\n== 2. initialize (misma tuberia, mismo proceso) ==");
const init = await rpc(
  "initialize",
  {
    protocolVersion: "2025-11-25",
    capabilities: { elicitation: { form: {}, url: {} } },
    clientInfo: { name: "antigravity-client", version: "v1.0.0" },
  },
  { timeoutMs: 30000 }
);
console.log("  crudo: " + JSON.stringify(init).slice(0, 400));
if (init.timeout) fail("initialize no respondio (¿el puente reenvio server/discover y node_repl cerro?)");
else if (init.result?.serverInfo?.name === "rmcp") {
  ok("initialize respondido por " + init.result.serverInfo.name + " " + init.result.serverInfo.version);
} else if (init.result) {
  ok("initialize respondido (serverInfo=" + JSON.stringify(init.result.serverInfo) + ")");
} else fail("initialize devolvio error: " + JSON.stringify(init.error));

notify("notifications/initialized", {});

console.log("\n== 3. tools/list ==");
const list = await rpc("tools/list", {}, { timeoutMs: 30000 });
const toolNames = (list.result?.tools ?? []).map((t) => t.name).sort();
console.log("  crudo: " + JSON.stringify(toolNames));
const expected = ["js", "js_add_node_module_dir", "js_reset", "turn_ended"];
for (const name of expected) {
  if (toolNames.includes(name)) ok("herramienta expuesta: " + name);
  else fail("falta la herramienta " + name);
}

console.log("\n== 4. turn_ended: el puente cierra el turno vigente (SIN metadatos del cliente) ==");
{
  // 4.1 Que turno inyecta el puente en una llamada normal.
  const before = await rpc(
    "tools/call",
    { name: "js", arguments: { code: READ_TURN_META, timeout_ms: 60000 } },
    { timeoutMs: 90000 }
  );
  let beforeTurn = null;
  try {
    beforeTurn = JSON.parse(extractPayload(before.result))?.meta ?? null;
  } catch {}
  if (!beforeTurn?.turn_id) fail("no se pudo leer el turno inyectado por el puente");
  else ok(`turno vigente inyectado: ${beforeTurn.session_id}/${beforeTurn.turn_id}`);

  // 4.2 Cierre con identificadores deliberadamente FALSOS, que es lo que haria un
  // agente que no conoce el turno sintetizado. El puente debe sustituirlos por los
  // del turno que acaba de correr (si no, browser-service no reconoce el turno y no
  // suelta la sesion de navegador).
  const ended = await rpc(
    "tools/call",
    {
      name: "turn_ended",
      arguments: { hook_event_name: "Stop", session_id: "wrong-session", turn_id: "wrong-turn" },
    },
    { timeoutMs: 60000 }
  );
  const endedText = extractPayload(ended.result);
  if (ended.timeout) fail("turn_ended no respondio (timeout)");
  else if (ended.error) fail("turn_ended devolvio error: " + JSON.stringify(ended.error).slice(0, 200));
  else ok("turn_ended aceptado tras normalizar los identificadores");

  const log = readBridgeLog();
  const normalized = new RegExp(`turn_ended normalizado al turno vigente ${beforeTurn?.session_id}/${beforeTurn?.turn_id}`).test(log);
  if (normalized) ok(`traza del puente confirma el turno cerrado: ${beforeTurn?.session_id}/${beforeTurn?.turn_id}`);
  else fail("la traza del puente no normaliza turn_ended al turno vigente");

  // 4.3 El contador SI avanza despues del cierre: lo siguiente es un turno nuevo.
  const after = await rpc(
    "tools/call",
    { name: "js", arguments: { code: READ_TURN_META, timeout_ms: 60000 } },
    { timeoutMs: 90000 }
  );
  let afterTurn = null;
  try {
    afterTurn = JSON.parse(extractPayload(after.result))?.meta ?? null;
  } catch {}
  if (!afterTurn?.turn_id) fail("no se pudo leer el turno inyectado tras turn_ended");
  else if (afterTurn.turn_id === beforeTurn?.turn_id) fail(`tras turn_ended el turno no avanzo (${afterTurn.turn_id})`);
  else ok(`tras turn_ended el turno avanza: ${beforeTurn?.turn_id} -> ${afterTurn.turn_id}`);
  if (endedText && /requires non-empty/i.test(endedText)) fail("node_repl rechazo los identificadores: " + endedText.slice(0, 200));
}

if (mode === "full") {
  console.log("\n== 5. tools/call js -> list_apps (SIN x-codex-turn-metadata) ==");
  // Mismo patron que la skill: `globalThis.sky ??= (await import("@oai/sky")).sky`.
  const APPS = `
let out = { step: "list_apps" };
try {
  const sky = (globalThis.sky ??= (await import("@oai/sky")).sky);
  const apps = await sky.list_apps();
  out.count = apps.length;
  out.first = apps.slice(0, 3).map(a => a.id ?? a.app ?? String(a));
} catch (e) { out.error = String(e && e.message); }
nodeRepl.write(JSON.stringify(out));
`;
  const callApps = await rpc(
    "tools/call",
    { name: "js", arguments: { code: APPS, timeout_ms: 60000 } },
    { timeoutMs: 90000 }
  );
  const appsText = extractPayload(callApps.result);
  console.log("  crudo: " + appsText.slice(0, 400));
  if (callApps.timeout) fail("list_apps por js agoto el tiempo");
  else if (!appsText) fail("respuesta vacia de js/list_apps: " + JSON.stringify(callApps).slice(0, 300));
  else {
    let parsed = null;
    try {
      parsed = JSON.parse(appsText);
    } catch {}
    if (parsed?.error) fail("list_apps fallo: " + parsed.error);
    else if ((parsed?.count ?? 0) > 0) ok("list_apps enumero " + parsed.count + " aplicaciones");
    else fail("list_apps no enumero aplicaciones: " + appsText.slice(0, 200));
  }

  console.log("\n== 5. tools/call js -> browser.listBrowsers() (SIN x-codex-turn-metadata) ==");
  const BROWSERS = `
let out = { step: "listBrowsers" };
try {
  const b = await import("browser");
  const list = await b.listBrowsers();
  out.count = list.length;
  out.browsers = list.map(x => ({ id: x.id, name: x.name, family: x.info ? x.info.family : undefined }));
} catch (e) { out.error = String(e && e.message); }
nodeRepl.write(JSON.stringify(out));
`;
  const callBrowsers = await rpc(
    "tools/call",
    { name: "js", arguments: { code: BROWSERS, timeout_ms: 60000 } },
    { timeoutMs: 90000 }
  );
  const browsersText = extractPayload(callBrowsers.result);
  console.log("  crudo: " + browsersText.slice(0, 600));
  if (callBrowsers.timeout) fail("listBrowsers por js agoto el tiempo");
  else if (!browsersText) fail("respuesta vacia de js/listBrowsers: " + JSON.stringify(callBrowsers).slice(0, 300));
  else {
    let parsed = null;
    try {
      parsed = JSON.parse(browsersText);
    } catch {}
    if (parsed == null) fail("la respuesta de listBrowsers no es JSON: " + browsersText.slice(0, 200));
    else if (parsed.error && /turn metadata/i.test(parsed.error)) {
      fail("browser-service sigue exigiendo metadatos de turno: " + parsed.error);
    } else if (parsed.error) {
      fail("listBrowsers fallo: " + parsed.error);
    } else {
      ok("listBrowsers respondio " + parsed.count + " navegador(es) sin metadatos de turno");
    }
  }
}

cleanup();
await new Promise((r) => setTimeout(r, 400));

console.log("");
if (childErr.trim()) {
  console.log("--- stderr del puente/hijo (primeras lineas) ---");
  console.log(childErr.split("\n").slice(0, 12).join("\n"));
  console.log("");
}
if (failures.length === 0) {
  console.log("  [OK] Puente MCP verificado (" + mode + "): TODO CORRECTO");
  process.exit(0);
}
console.log("  [FAIL] " + failures.length + " comprobacion(es) fallida(s):");
for (const f of failures) console.log("         - " + f);
process.exit(1);
