// A/B de la identidad de turno: demuestra que un `turn_id` que CAMBIA entre
// `tools/call` invalida las capturas (`unknown screenshotId screenshot-0`) y que la
// identidad estable no. Es la prueba que fija el contrato de v1.0.13.
//
// Protocolo real por stdio: `initialize` + `notifications/initialized` y `tools/call`
// sin `_meta` (lo que hace un cliente no-Codex). Secuencia de dos celdas sobre Paint:
//
//   celda 1: observar  -> get_window_state({include_screenshot:true}) -> screenshotId
//   celda 2: actuar    -> sky.drag({screenshotId}) con el id de la celda 1
//
// Variantes:
//   install          puente INSTALADO (<instalacion>\runtime\bin\mcp-bridge.mjs)
//   repo             puente del repo (runtime\bin\mcp-bridge.mjs), el que se empaqueta
//   direct-rotating  node_repl.exe directo, `_meta` con turn_id nuevo por llamada
//   direct-stable    node_repl.exe directo, `_meta` con turn_id estable
//   shim             shim manual del usuario (--shim <ruta>), que tambien rota turn-<N>
//
// Uso:
//   node scripts\ab-turn-identity.mjs <variante> [--install <dir>] [--shim <ruta>] [--out <dir>]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const argv = process.argv.slice(2);
const argOf = (name, dflt) => (argv.indexOf(name) !== -1 ? argv[argv.indexOf(name) + 1] : dflt);

const variant = argv[0];
const INSTALL = resolve(argOf("--install", join(process.env.USERPROFILE ?? "C:\\Users\\User", ".free-computer-user")));
const SHIM = argOf("--shim", join(process.env.USERPROFILE ?? "", ".gemini", "config", "cu-mcp-shim.mjs"));
const OUT = resolve(argOf("--out", join(process.env.TEMP ?? ".", "cu-ab")));

const BIN = join(INSTALL, "runtime", "bin");
const BROWSER = join(INSTALL, "runtime", "browser");
const HOME = join(INSTALL, "home");
const REPL = join(BIN, "node_repl.exe");
const REPO_BRIDGE = join(ROOT, "runtime", "bin", "mcp-bridge.mjs");

if (!variant) {
  console.error("uso: node scripts\\ab-turn-identity.mjs <install|repo|direct-rotating|direct-stable|shim> [--install <dir>] [--shim <ruta>] [--out <dir>]");
  process.exit(2);
}

const env = {
  ...process.env,
  CODEX_HOME: HOME,
  NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS: "1000",
  NODE_REPL_NODE_MODULE_DIRS: join(BIN, "node_modules"),
  NODE_REPL_NODE_PATH: join(BIN, "node.exe"),
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

const nodeExe = join(BIN, "node.exe");
let command;
let args;
let injectMeta = true; // el puente/shim inyectan; en directo los manda el cliente
let needsDiscover = false;

switch (variant) {
  case "install":
    command = nodeExe;
    args = [join(BIN, "mcp-bridge.mjs"), "--disable-sandbox"];
    needsDiscover = true;
    break;
  case "repo":
    if (!existsSync(REPO_BRIDGE)) {
      console.error("falta " + REPO_BRIDGE);
      process.exit(2);
    }
    command = nodeExe;
    args = [REPO_BRIDGE, "--bridge-repl", REPL, "--disable-sandbox"];
    needsDiscover = true;
    break;
  case "shim":
    if (!existsSync(SHIM)) {
      console.error("no encuentro el shim en " + SHIM + " (usa --shim <ruta>)");
      process.exit(2);
    }
    env.CU_NODE_REPL_EXE = REPL;
    command = nodeExe;
    args = [SHIM, "--disable-sandbox"];
    break;
  case "direct-rotating":
  case "direct-stable":
    command = REPL;
    args = ["--disable-sandbox"];
    injectMeta = false;
    break;
  default:
    console.error("variante desconocida: " + variant);
    process.exit(2);
}

const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
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
    // Peticion del servidor al cliente: `elicitation/create` se acepta siempre (el
    // puente la auto-responde; en modo directo hay que responderla aqui).
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

let turnSeq = 0;
function turnMeta() {
  const turn_id = variant === "direct-stable" ? "turn-1" : `turn-${++turnSeq}`;
  return JSON.stringify({ session_id: "ab-client-session", turn_id, thread_source: "user" });
}

async function callTool(name, argsObj, timeoutMs = 180000) {
  const params = { name, arguments: argsObj };
  if (!injectMeta) params._meta = { "x-codex-turn-metadata": turnMeta() };
  return rpc("tools/call", params, timeoutMs);
}

function payloadText(result) {
  return (result?.content ?? [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

const report = { variant, install: INSTALL, steps: [] };
const say = (s) => console.log(s);

if (needsDiscover) {
  const disc = await rpc("server/discover", { protocolVersion: "2026-07-28" });
  report.steps.push({ step: "server/discover", response: disc });
  say(`[discover] ${JSON.stringify(disc).slice(0, 140)}`);
}
const init = await rpc("initialize", {
  protocolVersion: "2025-11-25",
  capabilities: { elicitation: { form: {}, url: {} } },
  clientInfo: { name: "ab-turn-identity", version: "0.0.1" },
});
report.steps.push({ step: "initialize", serverInfo: init.result?.serverInfo ?? init });
say(`[initialize] ${JSON.stringify(init.result?.serverInfo ?? init).slice(0, 140)}`);
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

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
report.steps.push({ step: "cell1-observe", text: t1.slice(0, 700), isError: c1.result?.isError ?? null });
say(`\n[celda 1 - observar] ${t1.slice(0, 700)}`);

let shotId = null;
try {
  const parsed = JSON.parse(t1.slice(t1.indexOf("{"), t1.lastIndexOf("}") + 1));
  shotId = parsed.screenshotId ?? null;
} catch {}

let dragError = null;
if (shotId) {
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
  report.steps.push({ step: "cell2-drag", text: t2.slice(0, 700), isError: c2.result?.isError ?? null });
  say(`[celda 2 - drag con ${shotId}] ${t2.slice(0, 700)}`);
  try {
    dragError = JSON.parse(t2.slice(t2.indexOf("{"), t2.lastIndexOf("}") + 1)).error ?? null;
  } catch {}
} else {
  say("[celda 2] omitida: sin screenshotId");
}

try {
  await callTool("turn_ended", { hook_event_name: "Stop", session_id: "ab-client-session", turn_id: "turn-1" }, 60000);
} catch {}

report.serverRequests = serverRequests;
report.verdict = dragError ? `FALLA (${dragError})` : "OK";
mkdirSync(OUT, { recursive: true });
const outPath = join(OUT, `${variant}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));
say(`\n[informe] ${outPath}`);
say(`[veredicto] ${variant}: ${report.verdict}`);
if (childErr.trim()) say("[stderr] " + childErr.split("\n").slice(0, 6).join(" | "));

try {
  child.stdin.end();
} catch {}
setTimeout(() => {
  try {
    child.kill();
  } catch {}
  process.exit(dragError ? 1 : 0);
}, 1200);
