// A/B de los MARCADORES DE INTERRUPCION rancios: demuestra que un marcador olvidado
// bloquea una sesion nueva (mensaje de la tecla Escape) y que la limpieza del puente
// al arrancar lo evita. Es la prueba que fija el contrato de v1.0.13 para el escritorio.
//
// `helper_transport.js` escribe un fichero VACIO en
//   <CODEX_HOME>\cache\computer-use\interrupts\<session_id>\<turn_id>
// cuando el helper aborta porque el usuario pulso Escape, y en CADA `request` comprueba
// `existsSync(esa ruta)` antes de hablar con el helper: si existe, rechaza la llamada
// con "Computer Use was stopped by the user with the physical Escape key..." sin
// intentarlo. Nadie borra el fichero. Si una sesion nueva reutiliza la pareja
// (sesion, turno), el motor esta bloqueado desde la primera llamada.
//
// El cliente de esta prueba manda `_meta` FIJO en la sesion que el puente usa y limpia
// (`default-mcp-session`), asi que el marcador puesto a mano casa siempre y la UNICA
// variable entre las dos variantes es la limpieza del puente:
//
//   before  puente SIN limpieza (el estado instalado antes del arreglo) + marcador a mano
//           -> la primera celda se rechaza con el mensaje de Escape
//   after   puente del repo CON limpieza + el MISMO marcador a mano
//           -> el puente borra el marcador al arrancar, la celda 1 observa, la celda 2
//              dibuja en Paint (drag con el screenshotId de la celda 1) y la celda 3
//              captura la prueba
//
// Control C (dentro de la variante `after`): con el mismo proceso ya arrancado se vuelve a
// escribir el marcador a mano y se repite una celda con la MISMA identidad -> se rechaza.
// Eso aisla la causa (el fichero) frente a cualquier otro efecto de la limpieza.
//
// Uso:
//   node scripts\ab-interrupt-markers.mjs before [--install <dir>] [--bridge <ruta>] [--out <dir>]
//   node scripts\ab-interrupt-markers.mjs after  [--install <dir>] [--bridge <ruta>] [--out <dir>]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const argv = process.argv.slice(2);
const argOf = (name, dflt) => (argv.indexOf(name) !== -1 ? argv[argv.indexOf(name) + 1] : dflt);

const variant = argv[0];
const INSTALL = resolve(argOf("--install", join(process.env.USERPROFILE ?? "C:\\Users\\User", ".free-computer-user")));
const OUT = resolve(argOf("--out", join(process.env.TEMP ?? ".", "cu-ab")));

const BIN = join(INSTALL, "runtime", "bin");
const BROWSER = join(INSTALL, "runtime", "browser");
const HOME = join(INSTALL, "home");
const REPL = join(BIN, "node_repl.exe");
const NODE = join(BIN, "node.exe");
const REPO_BRIDGE = join(ROOT, "runtime", "bin", "mcp-bridge.mjs");
const INSTALL_BRIDGE = join(BIN, "mcp-bridge.mjs");

// Identidad FIJA del cliente, en la MISMA sesion que el puente: `default-mcp-session` es
// (a) la sesion que el puente inyecta a los clientes que no mandan `_meta` (Antigravity),
// (b) la que limpia al arrancar, y (c) la que usaba el shim antiguo con `turn-<N>` rotando
// desde 1 y la que usa por defecto el parche de `browser-service.mjs`. Es, por tanto, la
// sesion donde un marcador rancio de una ejecucion anterior bloquea la siguiente.
const SESSION = "default-mcp-session";
const TURN = "turn-esc-ab";
const SESSION_DIR = join(HOME, "cache", "computer-use", "interrupts", SESSION);
const MARKER = join(SESSION_DIR, TURN);

// Nombres de los marcadores presentes en la carpeta de la sesion (para poder afirmar que
// la limpieza del puente barrio tambien los rancios de ejecuciones anteriores).
function listSessionMarkers() {
  try {
    if (!existsSync(SESSION_DIR)) return [];
    return readdirSync(SESSION_DIR, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

if (variant !== "before" && variant !== "after") {
  console.error("uso: node scripts\\ab-interrupt-markers.mjs <before|after> [--install <dir>] [--bridge <ruta>] [--out <dir>]");
  process.exit(2);
}

function readHasCleanup(path) {
  try {
    if (!existsSync(path)) return false;
    return /clearStaleInterruptMarkers/.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

// Eleccion del puente:
//   before  el puente SIN limpieza. Preferencia: el INSTALADO (es literalmente "antes
//           del arreglo"); si ya estuviera arreglado, la version de HEAD (v1.0.12),
//           extraida a <out>\bridge-prefix-head.mjs para no depender del arbol de trabajo.
//   after   el puente del repo (el que se empaqueta).
function pickBridge() {
  const explicit = argOf("--bridge", null);
  if (explicit) return { path: resolve(explicit), origin: "--bridge" };
  if (variant === "after") {
    if (!existsSync(REPO_BRIDGE)) {
      console.error("falta " + REPO_BRIDGE);
      process.exit(2);
    }
    return { path: REPO_BRIDGE, origin: "repo" };
  }
  const installHasCleanup = readHasCleanup(INSTALL_BRIDGE);
  if (existsSync(INSTALL_BRIDGE) && !installHasCleanup) return { path: INSTALL_BRIDGE, origin: "install (sin limpieza)" };
  mkdirSync(OUT, { recursive: true });
  const headPath = join(OUT, "bridge-prefix-head.mjs");
  const show = spawnSync("git", ["show", "HEAD:runtime/bin/mcp-bridge.mjs"], { cwd: ROOT, encoding: "utf8" });
  if (show.status !== 0 || !show.stdout) {
    console.error("no pude extraer el puente de HEAD (git show): " + (show.stderr ?? "").slice(0, 200));
    process.exit(2);
  }
  writeFileSync(headPath, show.stdout);
  return { path: headPath, origin: "git HEAD (v1.0.12, sin limpieza)" };
}

const bridgeChoice = pickBridge();
const bridgePath = bridgeChoice.path;
const bridgeHasCleanup = readHasCleanup(bridgePath);

const env = {
  ...process.env,
  CODEX_HOME: HOME,
  NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS: "1000",
  NODE_REPL_NODE_MODULE_DIRS: join(BIN, "node_modules"),
  NODE_REPL_NODE_PATH: NODE,
  NODE_REPL_TRUSTED_CODE_PATHS: [HOME, join(BIN, "node_modules"), BROWSER].join(";"),
  NODE_REPL_TRUSTED_SERVICES: JSON.stringify({
    browser: join(BROWSER, "browser-service.mjs").replaceAll("\\", "/"),
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
};

mkdirSync(OUT, { recursive: true });
const bridgeLog = join(OUT, `${variant}-bridge.log`);
rmSync(bridgeLog, { force: true });

// ---------------------------------------------------------------------------
// Marcador puesto A MANO antes de arrancar el puente.
// ---------------------------------------------------------------------------
function writeMarker(reason) {
  mkdirSync(dirname(MARKER), { recursive: true });
  writeFileSync(MARKER, "", "utf8");
  return { reason, marker: MARKER, wrote: true };
}
function deleteMarker(reason) {
  const existed = existsSync(MARKER);
  rmSync(MARKER, { force: true });
  return { reason, existed };
}

rmSync(MARKER, { force: true });
const created = writeMarker("marcador creado a mano antes de arrancar el puente (interrupcion previa simulada)");
const markerExistedBeforeStart = existsSync(MARKER);
// Marcadores de la sesion ANTES de arrancar (incluye los rancios de ejecuciones previas).
const sessionMarkersBefore = listSessionMarkers();

console.log(`\n== A/B marcadores de interrupcion: variante ${variant} ==`);
console.log(`  sesion:   ${SESSION}`);
console.log(`  marcador: ${MARKER} (existe antes de arrancar: ${markerExistedBeforeStart})`);
console.log(`  marcadores en la sesion antes de arrancar: ${sessionMarkersBefore.join(", ") || "(ninguno)"}`);
console.log(`  puente:   ${bridgePath} [${bridgeChoice.origin}] limpieza=${bridgeHasCleanup}`);

const child = spawn(NODE, [bridgePath, "--bridge-repl", REPL, "--bridge-log", bridgeLog, "--disable-sandbox"], {
  env,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
let childErr = "";
child.stderr.on("data", (d) => (childErr += d.toString()));

let rx = Buffer.alloc(0);
const pending = new Map();
const serverRequests = [];
child.stdout.on("data", (chunk) => {
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
    if (msg.id !== undefined && msg.method !== undefined) {
      serverRequests.push(msg.method);
      if (msg.method === "elicitation/create") {
        child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { action: "accept", content: { persist: "session" } } }) + "\n"
        );
      }
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
function rpc(method, params, timeoutMs = 180000) {
  return new Promise((resolvePromise) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolvePromise({ timeout: true, id, method });
      }
    }, timeoutMs);
    pending.set(id, { resolve: resolvePromise, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

// `_meta` FIJO: la misma identidad en todas las celdas, para que el marcador case.
const FIXED_META = { "x-codex-turn-metadata": JSON.stringify({ session_id: SESSION, turn_id: TURN, thread_source: "user" }) };
function callTool(name, argsObj, timeoutMs = 180000) {
  return rpc("tools/call", { name, arguments: argsObj, _meta: { ...FIXED_META } }, timeoutMs);
}

function payloadText(result) {
  return (result?.content ?? [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

const ESCAPE_MARK = "was stopped by the user with the physical Escape key";
const report = {
  variant,
  bridge: bridgePath,
  bridgeOrigin: bridgeChoice.origin,
  bridgeHasCleanup,
  marker: MARKER,
  markerExistedBeforeStart,
  steps: [],
};

if (existsSync(MARKER) !== markerExistedBeforeStart) {
  console.error("el marcador cambio de estado antes de arrancar; abortando la medida");
  process.exit(2);
}

const disc = await rpc("server/discover", { protocolVersion: "2026-07-28" });
report.steps.push({ step: "server/discover", response: disc });
const init = await rpc("initialize", {
  protocolVersion: "2025-11-25",
  capabilities: { elicitation: { form: {}, url: {} } },
  clientInfo: { name: "ab-interrupt-markers", version: "0.0.1" },
});
report.steps.push({ step: "initialize", serverInfo: init.result?.serverInfo ?? init });
console.log(`  initialize -> ${JSON.stringify(init.result?.serverInfo ?? init).slice(0, 120)}`);
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

// Tras arrancar el puente, ?sigue el marcador? (el puente con limpieza debe haberlo borrado)
const markerAfterStart = existsSync(MARKER);
const sessionMarkersAfterStart = listSessionMarkers();
report.markerAfterStart = markerAfterStart;
report.sessionMarkersBefore = sessionMarkersBefore;
report.sessionMarkersAfterStart = sessionMarkersAfterStart;
console.log(`  marcador tras arrancar el puente: ${markerAfterStart ? "SIGUE (no se limpio)" : "borrado (limpieza al arrancar)"}`);
console.log(`  marcadores en la sesion tras arrancar: ${sessionMarkersAfterStart.join(", ") || "(ninguno)"}`);

const OBSERVE = `
let out={step:"observe"};
try{
  const sky=(globalThis.sky??=(await import("@oai/sky")).sky);
  const APP="Microsoft.Paint_8wekyb3d8bbwe!App";
  let apps=await sky.list_apps();
  let target=apps.find(a=>a.id===APP)||apps.find(a=>/Paint/i.test(a.id||""));
  if(!target || !(target.windows||[]).length){
    try{ await sky.launch_app({app:APP}); }catch(e){ out.launchError=String(e&&e.message); }
    await new Promise(r=>setTimeout(r,3000));
    apps=await sky.list_apps();
    target=apps.find(a=>a.id===APP)||apps.find(a=>/Paint/i.test(a.id||""));
  }
  if(!target||!(target.windows||[]).length){ out.error="Paint sin ventana"; }
  else{
    const w=target.windows[0];
    globalThis.paintWindow=await sky.get_window({id:w.id,app:w.app});
    await sky.activate_window({window:globalThis.paintWindow});
    globalThis.state=await sky.get_window_state({window:globalThis.paintWindow,include_screenshot:true,include_text:false});
    globalThis.paintWindow=globalThis.state.window;
    const shots=globalThis.state.screenshots||[];
    out.window={app:globalThis.paintWindow.app,id:globalThis.paintWindow.id,title:globalThis.paintWindow.title};
    out.shotCount=shots.length;
    out.screenshotId=shots[0]?.id??null;
    out.meta=JSON.parse(nodeRepl.requestMeta?.["x-codex-turn-metadata"] ?? "null");
  }
}catch(e){out.error=String(e&&e.message);}
nodeRepl.write(JSON.stringify(out));`;

const c1 = await callTool("js", { code: OBSERVE, timeout_ms: 150000 });
const t1 = payloadText(c1.result);
// El rechazo puede llegar como error de la celda (`isError`) o como excepcion capturada
// por el propio JS (`out.error`): en los dos casos el texto es el mismo.
const blocked1 = t1.includes(ESCAPE_MARK);
report.steps.push({ step: "cell1-observe", text: t1.slice(0, 900), isError: c1.result?.isError ?? null, blocked: blocked1 });
console.log(`\n  [celda 1 - observar] isError=${c1.result?.isError ?? null} escape=${blocked1}`);
console.log("  " + t1.slice(0, 500).replace(/\n/g, "\n  "));

let shotId = null;
try {
  const parsed = JSON.parse(t1.slice(t1.indexOf("{"), t1.lastIndexOf("}") + 1));
  shotId = parsed.screenshotId ?? null;
} catch {}

let dragError = null;
let savedShot = null;

if (!blocked1 && shotId) {
  const DRAG = `
let out={step:"drag"};
try{
  const sky=(globalThis.sky??=(await import("@oai/sky")).sky);
  await sky.drag({window:globalThis.paintWindow,screenshotId:${JSON.stringify(shotId)},from_x:320,from_y:260,to_x:520,to_y:300});
  out.ok=true;
}catch(e){out.error=String(e&&e.message);}
nodeRepl.write(JSON.stringify(out));`;
  const c2 = await callTool("js", { code: DRAG, timeout_ms: 150000 });
  const t2 = payloadText(c2.result);
  report.steps.push({ step: "cell2-drag", text: t2.slice(0, 900), isError: c2.result?.isError ?? null });
  console.log(`\n  [celda 2 - drag con ${shotId}] ${t2.slice(0, 500)}`);
  try {
    dragError = JSON.parse(t2.slice(t2.indexOf("{"), t2.lastIndexOf("}") + 1)).error ?? null;
  } catch {}

  // Evidencia grafica del trazo.
  const SHOT = `
let out={step:"capture"};
try{
  const sky=(globalThis.sky??=(await import("@oai/sky")).sky);
  const st=await sky.get_window_state({window:globalThis.paintWindow,include_screenshot:true,include_text:false});
  globalThis.paintWindow=st.window;
  const shots=st.screenshots||[];
  out.screenshotId=shots[0]?.id??null;
  out.shot=shots[0]?.data_url??shots[0]?.url??null;
}catch(e){out.error=String(e&&e.message);}
nodeRepl.write(JSON.stringify(out));`;
  const c3 = await callTool("js", { code: SHOT, timeout_ms: 150000 });
  const t3 = payloadText(c3.result);
  report.steps.push({ step: "cell3-capture", text: t3.replace(/"shot":"data:[^"]*"/, '"shot":"<...>"').slice(0, 500), isError: c3.result?.isError ?? null });
  try {
    const parsed = JSON.parse(t3.slice(t3.indexOf("{"), t3.lastIndexOf("}") + 1));
    if (parsed?.shot && /^data:image\//.test(parsed.shot)) {
      savedShot = join(OUT, `${variant}-paint-tras-dibujar.jpg`);
      writeFileSync(savedShot, Buffer.from(parsed.shot.slice(parsed.shot.indexOf(",") + 1), "base64"));
    }
  } catch {}
  if (savedShot) console.log(`  captura del trazo: ${savedShot}`);
}

// Control C (solo en `after`): reescribir el marcador con el MISMO proceso y la MISMA
// identidad -> vuelve a rechazarse. Aisla la causa: el fichero, no la limpieza.
let controlBlocked = null;
if (variant === "after" && !blocked1) {
  writeMarker("marcador reescrito a mano con el puente ya arrancado (control)");
  const c4 = await callTool("js", { code: OBSERVE, timeout_ms: 150000 });
  const t4 = payloadText(c4.result);
  controlBlocked = t4.includes(ESCAPE_MARK);
  report.steps.push({ step: "control-rewrite-marker", text: t4.slice(0, 900), isError: c4.result?.isError ?? null, blocked: controlBlocked });
  console.log(`\n  [control C - marcador reescrito] isError=${c4.result?.isError ?? null} escape=${controlBlocked}`);
  console.log("  " + t4.slice(0, 400).replace(/\n/g, "\n  "));
}

try {
  await callTool("turn_ended", { hook_event_name: "Stop", session_id: SESSION, turn_id: TURN }, 60000);
} catch {}

// La prueba no deja marcadores: el de esta sesion se borra al terminar (es justo lo que
// el puente hace al arrancar, pero aqui no queremos dejar basura al usuario).
const cleanedAtEnd = deleteMarker("limpieza final de la prueba");

report.serverRequests = serverRequests;
report.cleanedAtEnd = cleanedAtEnd;
report.savedShot = savedShot;
report.dragError = dragError;
report.controlBlocked = controlBlocked;

let verdict;
if (variant === "before") {
  verdict = blocked1 ? "OK (el marcador rancio bloquea: mensaje de Escape)" : "FALLA (el marcador no bloqueo la primera celda)";
} else {
  const cleanedAtStart = !markerAfterStart;
  const clean = cleanedAtStart && !blocked1 && !dragError && savedShot;
  verdict = clean && controlBlocked === true
    ? "OK (limpia al arrancar, dibuja, y el control con el marcador reescrito si bloquea)"
    : clean
      ? "PARCIAL (dibuja pero el control no bloqueo)"
      : !cleanedAtStart
        ? "FALLA (el marcador seguia tras arrancar el puente)"
        : blocked1
          ? "FALLA (siguio bloqueada pese a la limpieza)"
          : `FALLA (drag: ${dragError ?? "sin screenshotId"})`;
}
report.verdict = verdict;

writeFileSync(join(OUT, `${variant}-interrupt-markers.json`), JSON.stringify(report, null, 2));
console.log(`\n[informe] ${join(OUT, `${variant}-interrupt-markers.json`)}`);
console.log(`[log del puente] ${bridgeLog}`);
console.log(`[veredicto] ${variant}: ${verdict}`);
if (childErr.trim()) console.log("[stderr] " + childErr.split("\n").slice(0, 8).join(" | "));

try {
  child.stdin.end();
} catch {}
setTimeout(() => {
  try {
    child.kill();
  } catch {}
  process.exit(String(verdict).startsWith("OK") ? 0 : 1);
}, 1200);
