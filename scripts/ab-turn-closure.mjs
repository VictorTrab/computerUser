// A/B del cierre de turno a mitad de sesion: decide si `turn_ended`, el hook nativo o
// `js_reset` invalidan el estado del turno (capturas) que luego usa una accion por
// coordenadas. Cliente directo a `node_repl.exe` con identidad de turno ESTABLE, de modo
// que lo unico que cambia entre variantes es la llamada de cierre.
//
//   celda 1: observar (guarda screenshotId) -> CIERRE -> celda 2: drag con ese id
//
// Modos:
//   none  control, sin cierre
//   tool  tools/call turn_ended con los ids vigentes
//   hook  codex-computer-use.exe turn-ended <json> con los ids vigentes
//   both  turn_ended + hook (lo que hacia la skill §9 completa)
//   reset tools/call js_reset
//
// Uso: node scripts\ab-turn-closure.mjs <none|tool|hook|both|reset> [--install <dir>] [--out <dir>]
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (name, dflt) => (argv.indexOf(name) !== -1 ? argv[argv.indexOf(name) + 1] : dflt);
const mode = argv[0] ?? "none";
const INSTALL = resolve(argOf("--install", join(process.env.USERPROFILE ?? "C:\\Users\\User", ".free-computer-user")));
const OUT = resolve(argOf("--out", join(process.env.TEMP ?? ".", "cu-ab")));

const BIN = join(INSTALL, "runtime", "bin");
const BROWSER = join(INSTALL, "runtime", "browser");
const HOME = join(INSTALL, "home");
const REPL = join(BIN, "node_repl.exe");
const HELPER = join(BIN, "node_modules", "@oai", "sky", "bin", "windows", "codex-computer-use.exe");

const SESSION = "close-mid-session";
const TURN = "turn-1";
const META = JSON.stringify({ session_id: SESSION, turn_id: TURN, thread_source: "user" });

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

const child = spawn(REPL, ["--disable-sandbox"], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
let childErr = "";
child.stderr.on("data", (d) => (childErr += d.toString()));

let rx = Buffer.alloc(0);
const pending = new Map();
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
      if (msg.method === "elicitation/create") {
        child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { action: "accept", content: { persist: "session" } } }) + "\n"
        );
      }
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const e = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(e.timer);
      e.resolve(msg);
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

const payloadText = (result) =>
  (result?.content ?? []).filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");

async function js(code, timeoutMs = 150000) {
  const res = await rpc("tools/call", { name: "js", arguments: { code, timeout_ms: timeoutMs }, _meta: { "x-codex-turn-metadata": META } }, timeoutMs);
  return { text: payloadText(res.result), isError: res.result?.isError ?? null, timeout: res.timeout === true };
}

const report = { mode, session: SESSION, turn: TURN, steps: [] };
const say = (s) => console.log(s);

const init = await rpc("initialize", {
  protocolVersion: "2025-11-25",
  capabilities: { elicitation: { form: {}, url: {} } },
  clientInfo: { name: "ab-turn-closure", version: "0.0.1" },
});
report.steps.push({ step: "initialize", serverInfo: init.result?.serverInfo ?? init });
say(`[initialize] ${JSON.stringify(init.result?.serverInfo ?? init)}`);
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
    out.screenshotId=(globalThis.state.screenshots||[])[0]?.id??null;
    out.meta=JSON.parse(nodeRepl.requestMeta?.["x-codex-turn-metadata"] ?? "null");
  }
}catch(e){out.error=String(e&&e.message);}
nodeRepl.write(JSON.stringify(out));`;

const c1 = await js(OBSERVE);
report.steps.push({ step: "cell1", text: c1.text.slice(0, 600) });
say(`[celda 1] ${c1.text.slice(0, 600)}`);
let shotId = null;
try {
  shotId = JSON.parse(c1.text.slice(c1.text.indexOf("{"), c1.text.lastIndexOf("}") + 1)).screenshotId ?? null;
} catch {}

if (mode === "tool" || mode === "both") {
  const res = await rpc(
    "tools/call",
    { name: "turn_ended", arguments: { hook_event_name: "Stop", session_id: SESSION, turn_id: TURN }, _meta: { "x-codex-turn-metadata": META } },
    60000
  );
  report.steps.push({ step: "turn_ended", result: JSON.stringify(res.result ?? res).slice(0, 300) });
  say(`[cierre: tools/call turn_ended] ${JSON.stringify(res.result ?? res).slice(0, 200)}`);
}
if (mode === "hook" || mode === "both") {
  let hookOut = "";
  try {
    hookOut = execFileSync(HELPER, ["turn-ended", JSON.stringify({ session_id: SESSION, turn_id: TURN })], {
      timeout: 15000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    hookOut = "ERROR " + e.message;
  }
  report.steps.push({ step: "native-hook", output: String(hookOut).slice(0, 300) });
  say(`[cierre: hook nativo] ${String(hookOut).slice(0, 150) || "(sin salida)"}`);
}
if (mode === "reset") {
  const res = await rpc("tools/call", { name: "js_reset", arguments: {}, _meta: { "x-codex-turn-metadata": META } }, 120000);
  report.steps.push({ step: "js_reset", result: JSON.stringify(res.result ?? res).slice(0, 300) });
  say(`[cierre: js_reset] ${JSON.stringify(res.result ?? res).slice(0, 200)}`);
}

let dragError = null;
if (shotId) {
  const DRAG = `
let out={step:"drag"};
try{
  const sky=(globalThis.sky??=(await import("@oai/sky")).sky);
  let w=globalThis.paintWindow;
  if(!w){
    const apps=await sky.list_apps();
    const t=apps.find(a=>a.id==="Microsoft.Paint_8wekyb3d8bbwe!App")||apps.find(a=>/Paint/i.test(a.id||""));
    const win=(t&&t.windows&&t.windows[0])||null;
    if(!win) throw new Error("Paint no expone ventana tras el cierre");
    w=await sky.get_window({id:win.id,app:win.app});
    globalThis.paintWindow=w;
    out.reselected=true;
  }
  await sky.drag({window:w,screenshotId:${JSON.stringify(shotId)},from_x:320,from_y:260,to_x:520,to_y:300});
  out.ok=true;
}catch(e){out.error=String(e&&e.message);}
nodeRepl.write(JSON.stringify(out));`;
  const c2 = await js(DRAG);
  report.steps.push({ step: "cell2-drag", text: c2.text.slice(0, 600), isError: c2.isError });
  say(`[celda 2 - drag con ${shotId}] ${c2.text.slice(0, 600)}`);
  try {
    dragError = JSON.parse(c2.text.slice(c2.text.indexOf("{"), c2.text.lastIndexOf("}") + 1)).error ?? null;
  } catch {}
} else {
  say("[celda 2] omitida: sin screenshotId");
}

report.verdict = dragError ? `FALLA (${dragError})` : "OK";
mkdirSync(OUT, { recursive: true });
const outPath = join(OUT, `closure-${mode}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));
say(`\n[informe] ${outPath}`);
say(`[veredicto] cierre=${mode}: ${report.verdict}`);
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
