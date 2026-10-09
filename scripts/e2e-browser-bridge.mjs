// Prueba REAL de navegador a traves del puente MCP stdio, con el protocolo de un cliente
// no-Codex (initialize + notifications/initialized, `tools/call` SIN `_meta`, que es lo que
// manda Antigravity y lo que el puente rellena).
//
//   1. listBrowsers() -> el navegador conectado (la extension cargada).
//   2. getBrowser(familia) + nameSession + pestana nueva + goto(URL) + DOM real.
//   3. captura JPEG de la pestana (evidencia).
//   4. cierre de la pestana efimera y `turn_ended` por el puente.
//
// Por defecto Brave + YouTube (el caso verificado en Antigravity). El error de metadatos
// ("Missing required Codex turn metadata") y el de las capturas de escritorio
// ("unknown screenshotId") no aplican aqui: si esto pasa, el puente y el navegador van.
//
// Uso:
//   node scripts\e2e-browser-bridge.mjs [--install <dir>] [--bridge <ruta>] [--browser brave|chrome|edge]
//                                       [--url https://www.youtube.com] [--out <dir>]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const argOf = (name, dflt) => (argv.indexOf(name) !== -1 ? argv[argv.indexOf(name) + 1] : dflt);

const INSTALL = resolve(argOf("--install", join(process.env.USERPROFILE ?? "C:\\Users\\User", ".free-computer-user")));
const OUT = resolve(argOf("--out", join(process.env.TEMP ?? ".", "cu-e2e")));
const FAMILY = String(argOf("--browser", "brave")).toLowerCase();
const URL = argOf("--url", "https://www.youtube.com");

const BIN = join(INSTALL, "runtime", "bin");
const BROWSER = join(INSTALL, "runtime", "browser");
const HOME = join(INSTALL, "home");
const NODE = join(BIN, "node.exe");
const REPL = join(BIN, "node_repl.exe");
const BRIDGE = resolve(argOf("--bridge", join(BIN, "mcp-bridge.mjs")));

const failures = [];
const ok = (m) => console.log("  [OK] " + m);
const fail = (m) => {
  failures.push(m);
  console.log("  [FAIL] " + m);
};

if (!existsSync(BRIDGE)) {
  console.error("falta el puente: " + BRIDGE);
  process.exit(2);
}
if (!existsSync(REPL)) {
  console.error("falta node_repl.exe: " + REPL);
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const bridgeLog = join(OUT, "browser-bridge.log");
rmSync(bridgeLog, { force: true });

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

console.log(`\n== E2E navegador por el puente: ${FAMILY} + ${URL} ==`);
console.log(`  puente: ${BRIDGE}`);

const child = spawn(NODE, [BRIDGE, "--bridge-repl", REPL, "--bridge-log", bridgeLog, "--disable-sandbox"], {
  env,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
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

// Cliente no-Codex: `_meta` NO se manda (lo inyecta el puente).
function callTool(name, argsObj, timeoutMs = 180000) {
  return rpc("tools/call", { name, arguments: argsObj }, timeoutMs);
}
function payloadText(result) {
  return (result?.content ?? [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}
async function js(code, label, timeoutMs = 180000) {
  const t0 = Date.now();
  const res = await callTool("js", { code, timeout_ms: timeoutMs - 30000 }, timeoutMs);
  const seconds = ((Date.now() - t0) / 1000).toFixed(2);
  const text = payloadText(res.result);
  if (res.timeout) fail(`${label}: timeout (${seconds}s)`);
  return { text, seconds, isError: res.result?.isError ?? null };
}
function parseCell(text) {
  try {
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
}

const disc = await rpc("server/discover", { protocolVersion: "2026-07-28" });
console.log(`  server/discover -> ${JSON.stringify(disc.error ?? disc.result).slice(0, 100)}`);
const init = await rpc("initialize", {
  protocolVersion: "2025-11-25",
  capabilities: { elicitation: { form: {}, url: {} } },
  clientInfo: { name: "antigravity-browser-e2e", version: "1.0.0" },
});
if (init.result?.serverInfo?.name === "rmcp") ok("initialize -> rmcp " + init.result.serverInfo.version);
else fail("initialize inesperado: " + JSON.stringify(init).slice(0, 200));
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

// --- 1. Navegadores conectados ---------------------------------------------
console.log("\n== 1. listBrowsers() ==");
const step1 = await js(
  `let out={step:"listBrowsers"};try{const b=await import("browser");const list=await b.listBrowsers();
    out.count=list.length;out.browsers=list.map(x=>({id:x.id,name:x.name,family:x.info?.family,type:x.info?.type}));
   }catch(e){out.error=String(e&&e.message);}nodeRepl.write(JSON.stringify(out));`,
  "listBrowsers"
);
console.log("  crudo (" + step1.seconds + "s): " + step1.text.slice(0, 400));
const browsers = parseCell(step1.text);
if (browsers?.error) fail("listBrowsers: " + browsers.error);
else ok(`listBrowsers -> ${browsers?.count} navegador(es): ${JSON.stringify(browsers?.browsers)}`);
if (!browsers?.browsers?.some((b) => String(b.family ?? "").toLowerCase() === FAMILY || String(b.name ?? "").toLowerCase().includes(FAMILY))) {
  fail(`el navegador '${FAMILY}' no aparece entre los conectados (abre ${FAMILY} con la extension cargada)`);
}

// --- 2. Conectar, pestana nueva, YouTube -----------------------------------
console.log(`\n== 2. ${FAMILY}: nameSession + pestana nueva + goto(${URL}) ==`);
const step2 = await js(
  `let out={step:"navigate"};
   try{
     const b=await import("browser");
     const br=await b.getBrowser(${JSON.stringify(FAMILY)});
     await br.nameSession("ComputerUser v1.0.13 e2e navegador");
     globalThis.e2eTab=await br.tabs.new();
     await globalThis.e2eTab.goto(${JSON.stringify(URL)});
     await globalThis.e2eTab.playwright.waitForLoadState({state:"domcontentloaded",timeoutMs:30000});
     out.url=await globalThis.e2eTab.url();
     out.title=await globalThis.e2eTab.title();
     out.links=await globalThis.e2eTab.playwright.evaluate(()=>document.querySelectorAll("a").length);
     out.videos=await globalThis.e2eTab.playwright.evaluate(()=>document.querySelectorAll("ytd-rich-item-renderer, ytd-video-renderer").length);
     out.searchBox=await globalThis.e2eTab.playwright.evaluate(()=>!!document.querySelector("input#search, input[name='search_query']"));
     // tab.screenshot() devuelve un Buffer (JPEG), no un data URL: se convierte aqui.
     const shot=await globalThis.e2eTab.screenshot({});
     out.shotBytes=Buffer.isBuffer(shot)?shot.length:(shot?.byteLength??null);
     out.shot="data:image/jpeg;base64,"+Buffer.from(shot).toString("base64");
   }catch(e){out.error=String(e&&e.message);out.stack=String(e&&e.stack).slice(0,300);}
   nodeRepl.write(JSON.stringify(out));`,
  `goto ${URL}`,
  240000
);
console.log("  crudo (" + step2.seconds + "s): " + step2.text.replace(/"shot":"data:[^"]*"/, '"shot":"<...>"').slice(0, 400));
const nav = parseCell(step2.text);
let shotPath = null;
if (nav?.error) fail("navegacion: " + nav.error);
else {
  ok(`url=${nav?.url}`);
  ok(`title=${nav?.title}`);
  ok(`DOM: ${nav?.links} enlaces, ${nav?.videos} videos, caja de busqueda=${nav?.searchBox}`);
  if (!/youtube\.com/i.test(String(nav?.url ?? ""))) fail("la URL final no es de YouTube: " + nav?.url);
  if (nav?.shot && /^data:image\//.test(nav.shot)) {
    // `tab.screenshot()` devuelve JPEG (no PNG): se guarda con extension .jpg.
    shotPath = join(OUT, `brave-youtube-${Date.now()}.jpg`);
    writeFileSync(shotPath, Buffer.from(nav.shot.slice(nav.shot.indexOf(",") + 1), "base64"));
    ok(`captura JPEG: ${shotPath} (${(await import("node:fs")).statSync(shotPath).size} bytes, del Buffer de ${nav?.shotBytes})`);
  } else {
    fail("no se pudo extraer la captura de la pestana");
  }
}

// --- 3. Busqueda real en YouTube (segunda navegacion) ----------------------
console.log("\n== 3. Segunda navegacion: resultados de busqueda ==");
const step3 = await js(
  `let out={step:"search"};
   try{
     await globalThis.e2eTab.goto("https://www.youtube.com/results?search_query=computer+use");
     await globalThis.e2eTab.playwright.waitForLoadState({state:"load",timeoutMs:40000});
     // YouTube hidrata los resultados despues del load: se espera al primer contenedor.
     try{ await globalThis.e2eTab.playwright.locator("ytd-video-renderer").first().waitFor({state:"attached",timeoutMs:25000}); }
     catch(e){ out.waitError=String(e&&e.message).slice(0,140); }
     out.url=await globalThis.e2eTab.url();
     out.title=await globalThis.e2eTab.title();
     out.videos=await globalThis.e2eTab.playwright.evaluate(()=>document.querySelectorAll("ytd-video-renderer").length);
     out.first=await globalThis.e2eTab.playwright.evaluate(()=>{
       const el=document.querySelector("ytd-video-renderer #video-title, ytd-video-renderer a#video-title");
       return el?el.textContent.trim().slice(0,120):null;});
   }catch(e){out.error=String(e&&e.message);}
   nodeRepl.write(JSON.stringify(out));`,
  "busqueda en YouTube",
  180000
);
console.log("  crudo (" + step3.seconds + "s): " + step3.text.slice(0, 400));
const search = parseCell(step3.text);
if (search?.error) fail("busqueda: " + search.error);
else {
  ok(`url=${search?.url} title=${JSON.stringify(search?.title)}`);
  ok(`resultados: ${search?.videos} contenedores de video; primero: ${JSON.stringify(search?.first)}`);
  if (!search?.first) fail("la pagina de resultados no expuso ningun titulo de video");
}

// --- 4. Cerrar la pestana efimera y cerrar el turno ------------------------
console.log("\n== 4. Cierre de la pestana efimera ==");
const step4 = await js(
  `let out={step:"close"};try{await globalThis.e2eTab.close();out.closed=true;
   }catch(e){out.error=String(e&&e.message);}nodeRepl.write(JSON.stringify(out));`,
  "tab.close()"
);
console.log("  crudo (" + step4.seconds + "s): " + step4.text.slice(0, 200));
const closed = parseCell(step4.text);
if (closed?.error) fail("tab.close(): " + closed.error);
else if (closed?.closed) ok("pestana efimera cerrada (el grupo de sesion queda sin la pestana de la prueba)");

// `turn_ended` sin ids: el puente los normaliza al turno vigente (comprobado en su traza).
const ended = await callTool("turn_ended", { hook_event_name: "Stop" }, 60000);
if (ended?.result?.isError) fail("turn_ended: " + payloadText(ended.result).slice(0, 200));
else ok("turn_ended aceptado (el puente normaliza los ids)");

try {
  child.stdin.end();
} catch {}
setTimeout(() => {
  try {
    child.kill();
  } catch {}
}, 400);

await new Promise((r) => setTimeout(r, 900));
let traceText = "";
try {
  traceText = (await import("node:fs")).readFileSync(bridgeLog, "utf8");
} catch {}
const normalized = /turn_ended normalizado/.test(traceText);
const injected = (traceText.match(/inyectado x-codex-turn-metadata/g) ?? []).length;
console.log(`\n  traza del puente: ${injected} tools/call con metadatos inyectados; turn_ended normalizado=${normalized}`);
if (injected === 0) fail("el puente no inyecto metadatos en ningun tools/call");
if (!normalized) fail("el puente no normalizo turn_ended");
if (childErr.trim()) console.log("--- stderr (primeras lineas) ---\n" + childErr.split("\n").slice(0, 8).join("\n"));

console.log("");
if (failures.length === 0) {
  console.log("  [OK] E2E de navegador por el puente: TODO CORRECTO");
  process.exit(0);
}
console.log(`  [FAIL] ${failures.length} fallo(s):`);
for (const f of failures) console.log("         - " + f);
process.exit(1);
