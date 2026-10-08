// ComputerUser end-to-end smoke test WITHOUT a real browser.
//
// It starts the real runtime (node_repl.exe) and the real native host
// (extension-host.exe), then impersonates the browser extension over the
// native-messaging protocol. This validates, on every build:
//   * `await import("browser")` resolves (shim inside node_modules)
//   * the offline runtime works with a CODEX_HOME that has NO auth.json
//     (no Codex/OpenAI account, no token, no network)
//   * the browser service is patched for local use
//   * the native host <-> runtime pipe bridge works end to end
//
// Usage: node smoke-browser-bridge.mjs <InstallDir>
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const installDir = process.argv[2] ?? process.cwd();
const binDir = join(installDir, "runtime", "bin");
const browserDir = join(installDir, "runtime", "browser");
const homeDir = join(installDir, "home");
const nodeReplExe = join(binDir, "node_repl.exe");
const nodeExe = join(binDir, "node.exe");
const extensionHost = join(installDir, "runtime", "extension-host", "windows", "x64", "extension-host.exe");
const manifestPath = join(installDir, "extension", "manifest.json");

const failures = [];
const ok = (msg) => console.log("  [OK] " + msg);
const fail = (msg) => {
  failures.push(msg);
  console.log("  [FAIL] " + msg);
};

// --- 0. Required files -------------------------------------------------------
for (const [label, path] of [
  ["node_repl.exe", nodeReplExe],
  ["node.exe", nodeExe],
  ["extension-host.exe", extensionHost],
  ["extension/manifest.json", manifestPath],
  ["browser-service.mjs", join(browserDir, "browser-service.mjs")],
  ["browser shim", join(binDir, "node_modules", "browser", "index.mjs")],
]) {
  if (existsSync(path)) ok(label + " presente");
  else fail(label + " ausente: " + path);
}
if (failures.length > 0) {
  console.log("\nSmoke test abortado: faltan componentes.");
  process.exit(1);
}

// --- 1. Extension id derived from the manifest key ---------------------------
let extensionId = "unknown";
try {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const der = Buffer.from(manifest.key, "base64");
  const digest = createHash("sha256").update(der).digest().subarray(0, 16);
  extensionId = "";
  for (const b of digest) {
    extensionId += String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15));
  }
  ok("extension id derivado del manifiesto: " + extensionId);
} catch (e) {
  fail("no se pudo derivar el extension id: " + e.message);
}

// --- 2. Fake extension (impersonates the browser) ---------------------------
const host = spawn(extensionHost, [`chrome-extension://${extensionId}/`, "--parent-window=0"], {
  env: { ...process.env, CODEX_HOME: homeDir },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
let hostErr = "";
host.stderr.on("data", (d) => (hostErr += d.toString()));

function sendToHost(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  host.stdin.write(Buffer.concat([header, payload]));
}

const replies = {
  getInfo: {
    family: "chrome",
    name: "Google Chrome",
    version: "smoke",
    type: "extension",
    agentRequestHeaderEnabled: false,
    browserTabMentions: {},
    capabilities: { browser: [{ id: "browser" }], tab: [] },
    metadata: { extensionId, extensionInstanceId: "smoke-instance" },
  },
  getTabs: [{ id: "101", title: "Smoke agent tab", url: "https://example.com/", active: true }],
  getUserTabs: [
    {
      id: "837015484",
      title: "Smoke user tab",
      url: "https://example.org/",
      lastOpened: new Date().toISOString(),
      providerTabId: '["smoke-instance","837015484"]',
    },
  ],
  nameSession: {},
};

let rx = Buffer.alloc(0);
let sawGetInfo = false;
host.stdout.on("data", (chunk) => {
  rx = Buffer.concat([rx, chunk]);
  for (;;) {
    if (rx.length < 4) return;
    const size = rx.readUInt32LE(0);
    if (rx.length < 4 + size) return;
    const body = rx.subarray(4, 4 + size).toString("utf8");
    rx = rx.subarray(4 + size);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      continue;
    }
    if (msg.method === "getInfo") sawGetInfo = true;
    if (msg.method && Object.prototype.hasOwnProperty.call(replies, msg.method)) {
      console.log("  [host -> smoke] " + msg.method);
      sendToHost({ jsonrpc: "2.0", id: msg.id, result: replies[msg.method] });
    }
  }
});

// --- 3. Runtime under test ---------------------------------------------------
const nodeModules = join(binDir, "node_modules");
const repl = spawn(nodeReplExe, ["--disable-sandbox"], {
  env: {
    ...process.env,
    CODEX_HOME: homeDir,
    NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS: "1000",
    NODE_REPL_NODE_MODULE_DIRS: nodeModules,
    NODE_REPL_NODE_PATH: nodeExe,
    NODE_REPL_TRUSTED_CODE_PATHS: [homeDir, nodeModules, browserDir].join(";"),
    NODE_REPL_TRUSTED_SERVICES: JSON.stringify({
      browser: join(browserDir, "browser-service.mjs").replace(/\\/g, "/"),
      sky: "@oai/sky/service",
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
let replErr = "";
repl.stderr.on("data", (d) => (replErr += d.toString()));

let buf = "";
const pending = new Map();
repl.stdout.on("data", (c) => {
  buf += c.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.id !== undefined && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  }
});
let nextId = 1;
const rpc = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    repl.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ timeout: true });
      }
    }, 60000);
  });

const cleanup = () => {
  try {
    host.kill();
  } catch {}
  try {
    repl.kill();
  } catch {}
};

await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "computeruser-smoke", version: "1.0.0" },
});
repl.stdin.write(
  JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n"
);

const SCRIPT = `
const out = {};
try {
  const m = await import("browser");
  out.exports = Object.keys(m).sort();
  const b = await m.getBrowser("chrome");
  out.browserId = b.browserId;
  out.agentTabs = (await b.tabs.list()).length;
  out.userTabs = (await b.user.openTabs()).length;
  await b.nameSession("smoke test");
  out.nameSession = "ok";
} catch (e) {
  out.error = String(e && e.message);
}
nodeRepl.write(JSON.stringify(out));
`;

const res = await rpc("tools/call", {
  name: "js",
  arguments: { code: SCRIPT, timeout_ms: 60000 },
  _meta: {
    "x-codex-turn-metadata": JSON.stringify({
      session_id: "computeruser-smoke",
      turn_id: "turn-smoke",
      thread_source: "user",
    }),
  },
});

cleanup();

// --- 4. Assertions -----------------------------------------------------------
console.log("");
let result = {};
const text = res?.result?.content?.[0]?.text;
if (res?.timeout) {
  fail("el runtime no respondio (timeout). El puente navegador <-> runtime no funciona.");
} else if (!text) {
  fail("respuesta inesperada del runtime: " + JSON.stringify(res).slice(0, 300));
} else {
  try {
    result = JSON.parse(text);
  } catch {
    fail("la respuesta no es JSON: " + text.slice(0, 200));
  }
}

if (result.error) fail("js fallo: " + result.error);
if (result.exports && !result.exports.includes("getBrowser")) fail("el shim no exporta getBrowser");
if (!sawGetInfo) fail("la extension falsa no recibio getInfo (el host no conecto con el runtime)");
if (result.agentTabs !== 1) fail("tabs.list() devolvio " + result.agentTabs + " en vez de 1");
if (result.userTabs !== 1) fail("user.openTabs() devolvio " + result.userTabs + " en vez de 1");
if (result.nameSession !== "ok") fail("nameSession() no completo");
if (result.error && /auth token|Codex/iu.test(result.error)) {
  fail("el runtime sigue exigiendo credenciales de Codex: " + result.error);
}

if (failures.length === 0) {
  console.log("  [OK] Smoke test del puente de navegador: TODO CORRECTO");
  process.exit(0);
}
console.log("  [FAIL] " + failures.length + " comprobacion(es) fallida(s):");
for (const f of failures) console.log("         - " + f);
if (hostErr.trim()) console.log("--- extension-host stderr ---\n" + hostErr.slice(0, 1200));
if (replErr.trim()) console.log("--- node_repl stderr ---\n" + replErr.slice(0, 1200));
process.exit(1);
