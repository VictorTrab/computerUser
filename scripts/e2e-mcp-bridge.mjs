// Prueba REAL de extremo a extremo a traves del puente MCP stdio, reservando el turno
// con el mismo protocolo que un cliente real (initialize + notifications/initialized,
// sin `_meta` en `tools/call`, que es lo que hace un cliente no-Codex).
//
//   1. Calculadora: `list_apps` -> `activate_window` -> `type_text("5+5=")` ->
//      `get_window_state` con captura -> guarda el JPG y marca el 10.
//   2. Navegador: `listBrowsers()`.
//
// Uso: node scripts/e2e-mcp-bridge.mjs [InstallDir] [--out <dir>]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const outAt = argv.indexOf("--out");
const outDir = outAt !== -1 ? resolve(argv[outAt + 1]) : join(process.env.TEMP ?? ".", "cu-e2e");
const installArg = argv.find((a, i) => !a.startsWith("--") && (outAt === -1 || i !== outAt + 1));
const installDir = resolve(installArg ?? process.cwd());

const binDir = join(installDir, "runtime", "bin");
const browserDir = join(installDir, "runtime", "browser");
const homeDir = join(installDir, "home");

const failures = [];
const ok = (m) => console.log("  [OK] " + m);
const fail = (m) => {
  failures.push(m);
  console.log("  [FAIL] " + m);
};

if (!existsSync(join(binDir, "mcp-bridge.mjs"))) {
  console.error("falta el puente en " + binDir);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const bridge = spawn(join(binDir, "node.exe"), [join(binDir, "mcp-bridge.mjs"), "--disable-sandbox"], {
  env: {
    ...process.env,
    CODEX_HOME: homeDir,
    NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS: "1000",
    NODE_REPL_NODE_MODULE_DIRS: join(binDir, "node_modules"),
    NODE_REPL_NODE_PATH: join(binDir, "node.exe"),
    NODE_REPL_TRUSTED_CODE_PATHS: [homeDir, join(binDir, "node_modules"), browserDir].join(";"),
    NODE_REPL_TRUSTED_SERVICES: JSON.stringify({
      browser: join(browserDir, "browser-service.mjs").replaceAll("\\", "/"),
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
bridge.stderr.on("data", (d) => (childErr += d.toString()));

let rx = Buffer.alloc(0);
const pending = new Map();
bridge.stdout.on("data", (chunk) => {
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
    bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

// Igual que un cliente real: initialize + initialized, y `tools/call` SIN `_meta`.
const init = await rpc("initialize", {
  protocolVersion: "2025-11-25",
  capabilities: { elicitation: { form: {}, url: {} } },
  clientInfo: { name: "antigravity-client", version: "v1.0.0" },
});
if (init.result?.serverInfo?.name === "rmcp") ok("initialize -> rmcp " + init.result.serverInfo.version);
else fail("initialize inesperado: " + JSON.stringify(init).slice(0, 200));
bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

function payload(result) {
  const text = (result?.content ?? [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  const start = text.indexOf("{");
  if (start === -1) return { text, json: null };
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
      if (depth === 0) {
        try {
          return { text, json: JSON.parse(text.slice(start, i + 1)) };
        } catch {
          return { text, json: null };
        }
      }
    }
  }
  return { text, json: null };
}

let jsExports = null;
async function js(code, label, timeoutMs = 180000) {
  const t0 = Date.now();
  const res = await rpc("tools/call", { name: "js", arguments: { code, timeout_ms: timeoutMs - 30000 } }, timeoutMs);
  const seconds = ((Date.now() - t0) / 1000).toFixed(2);
  if (res.timeout) {
    fail(`${label}: timeout (${seconds}s)`);
    return { json: null, seconds };
  }
  const { text, json } = payload(res.result);
  if (!text) {
    fail(`${label}: respuesta vacia ${JSON.stringify(res).slice(0, 300)}`);
    return { json: null, text, seconds };
  }
  return { json, text, seconds };
}

// ---------------------------------------------------------------------------
console.log("\n== 0. Capacidades del kernel `js` ==");
const probe = await js(
  `let out={};try{const sky=(globalThis.sky??=(await import("@oai/sky")).sky);out.sky=Object.keys(sky).sort();}catch(e){out.skyError=String(e&&e.message);}
   try{const b=await import("browser");out.browser=Object.keys(b).sort();}catch(e){out.browserError=String(e&&e.message);}
   nodeRepl.write(JSON.stringify(out));`,
  "capacidades"
);
jsExports = probe.json;
if (jsExports?.skyError) fail("sky no importa: " + jsExports.skyError);
if (jsExports?.browserError) fail("browser no importa: " + jsExports.browserError);
if (jsExports?.sky) ok("sky: " + jsExports.sky.length + " metodos");
if (jsExports?.browser) ok("browser: " + jsExports.browser.length + " exports");

// ---------------------------------------------------------------------------
console.log("\n== 1. Calculadora 5+5= (escritorio) ==");
const INIT_CALC = `
let out={step:"init"};
try{
  const sky=(globalThis.sky??=(await import("@oai/sky")).sky);
  // Seleccion EXACTAMENTE como la skill: list_apps() ya trae 'windows' por app.
  // No se llama list_windows() a secas (devuelve ventanas de apps no autorizadas y
  // sky-guard aborta: "Computer Use was not approved to use X").
  const CALC="Microsoft.WindowsCalculator_8wekyb3d8bbwe!App";
  let apps = await sky.list_apps();
  let target = apps.find(a=>a.id===CALC) || apps.find(a=>/Calculator/i.test(a.id||""));
  if(!target || !(target.windows||[]).length){
    await sky.launch_app({app:CALC});
    await new Promise(r=>setTimeout(r,2500));
    apps = await sky.list_apps();
    target = apps.find(a=>a.id===CALC) || apps.find(a=>/Calculator/i.test(a.id||""));
  }
  out.target = target ? {id:target.id,app:target.app,name:target.name,windowCount:(target.windows||[]).length} : null;
  if(!target){out.error="no encontre la Calculadora en list_apps";}
  else if(!(target.windows||[]).length){out.error="la Calculadora no expuso ventana";}
  else{
    const w = target.windows[0];
    out.window = {id:w.id,title:w.title,app:w.app};
    globalThis.targetWindow = await sky.get_window({id:w.id,app:w.app});
    await sky.activate_window({window:globalThis.targetWindow});
    out.selected = {id:w.id,title:w.title,app:w.app};
  }
}catch(e){out.error=String(e&&e.message);}
nodeRepl.write(JSON.stringify(out));`;
const step1 = await js(INIT_CALC, "listar+seleccionar+activar Calculadora");
console.log("  crudo (" + step1.seconds + "s): " + (step1.text ?? "").slice(0, 500));
if (step1.json?.error) fail("seleccion de Calculadora: " + step1.json.error);
else if (step1.json?.selected) ok("ventana seleccionada: " + JSON.stringify(step1.json.selected));

const TYPE = `
let out={step:"type"};
try{
  const sky=(globalThis.sky??=(await import("@oai/sky")).sky);
  await sky.press_key({window:globalThis.targetWindow,key:"Escape"});
  await sky.type_text({window:globalThis.targetWindow,text:"5+5="});
  globalThis.state = await sky.get_window_state({window:globalThis.targetWindow,include_screenshot:true,include_text:true});
  out.screenshotId = globalThis.state?.screenshotId ?? null;
  const shots = globalThis.state?.screenshots ?? [];
  out.shotCount = shots.length;
  out.shotBytes = shots[0]?.data_url ? shots[0].data_url.length : (shots[0]?.url ? shots[0].url.length : 0);
  out.shot = shots[0]?.data_url ?? shots[0]?.url ?? null;
  out.textLen = (globalThis.state?.accessibility?.tree||globalThis.state?.accessibility?.document_text||"").length;
}catch(e){out.error=String(e&&e.message);}
nodeRepl.write(JSON.stringify(out));`;
const step2 = await js(TYPE, "5+5= y captura");
const shot = step2.json?.shot ?? null;
let savedPath = null;
if (shot && /^data:image\//.test(shot)) {
  const b64 = shot.slice(shot.indexOf(",") + 1);
  savedPath = join(outDir, "calc_5_mas_5.jpg");
  writeFileSync(savedPath, Buffer.from(b64, "base64"));
} else if (step2.json?.error) {
  fail("typing/captura: " + step2.json.error);
}
console.log("  crudo (" + step2.seconds + "s): " + (step2.text ?? "").replace(/"shot":"data:[^"]{0,40}[^"]*"/, '"shot":"<...>"').slice(0, 400));
if (savedPath) {
  const bytes = (await import("node:fs")).statSync(savedPath).size;
  ok(`captura guardada: ${savedPath} (${bytes} bytes)`);
} else if (!step2.json?.error) {
  fail("no se pudo extraer la captura de la respuesta");
}

// ---------------------------------------------------------------------------
console.log("\n== 2. Navegador: listBrowsers() ==");
const BROWSERS = `
let out={step:"listBrowsers"};
try{
  const b=await import("browser");
  const list=await b.listBrowsers();
  out.count=list.length;
  out.browsers=list.map(x=>({id:x.id,name:x.name,family:x.info?.family,type:x.info?.type}));
}catch(e){out.error=String(e&&e.message);}
nodeRepl.write(JSON.stringify(out));`;
const step3 = await js(BROWSERS, "listBrowsers");
console.log("  crudo (" + step3.seconds + "s): " + (step3.text ?? "").slice(0, 500));
if (step3.json?.error) fail("listBrowsers: " + step3.json.error);
else ok("listBrowsers -> " + step3.json?.count + " navegador(es): " + JSON.stringify(step3.json?.browsers));

try {
  bridge.stdin.end();
} catch {}
setTimeout(() => {
  try {
    bridge.kill();
  } catch {}
}, 400);

await new Promise((r) => setTimeout(r, 900));
console.log("");
if (childErr.trim()) console.log("--- stderr (primeras lineas) ---\n" + childErr.split("\n").slice(0, 10).join("\n"));
if (failures.length === 0) {
  console.log("  [OK] E2E a traves del puente: TODO CORRECTO");
  process.exit(0);
}
console.log("  [FAIL] " + failures.length + " fallo(s):");
for (const f of failures) console.log("         - " + f);
process.exit(1);
