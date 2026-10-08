// A/B del parche de metadatos de turno: demuestra que SIN el parche el servicio de
// navegador aborta con "Missing required Codex turn metadata" cuando el cliente no
// manda `_meta`, y que CON el parche funciona.
//
// Uso: node scripts/verify-turn-metadata-patch.mjs [InstallDir]
import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TURN_METADATA_INJECTED } from "../runtime/browser/patch-turn-metadata.mjs";

const installDir = resolve(process.argv[2] ?? join(import.meta.dirname, ".."));
const binDir = join(installDir, "runtime", "bin");
const browserDir = join(installDir, "runtime", "browser");
const homeDir = join(installDir, "home");
const service = join(browserDir, "browser-service.mjs");

const MARKER = "/* ComputerUser patch: default turn metadata */";
// El snippet inyectado se importa del propio aplicador: una unica fuente de verdad
// (si el parche cambia, esta copia A/B cambia con el y no puede quedar desincronizada).
const INJECTED = TURN_METADATA_INJECTED;

// La copia sin parche TIENE que vivir dentro de un trusted code path del kernel de
// node_repl (NODE_REPL_TRUSTED_CODE_PATHS incluye runtime\browser): en %TEMP% el
// kernel la rechaza con "Trusted RPC dependency must resolve within a configured
// trusted code path" y la prueba A/B no discriminaria nada.
const unpatchedPath = join(browserDir, "browser-service-unpatched.ab.mjs");
{
  const patched = readFileSync(service, "latin1");
  if (!patched.includes(MARKER)) {
    console.error("[FAIL] browser-service.mjs no esta parcheado; ejecuta el parche primero.");
    process.exit(1);
  }
  const unpatched = patched.split(MARKER).join("").split(INJECTED).join("");
  writeFileSync(unpatchedPath, unpatched, "latin1");
  console.log(`  copia sin parche: ${unpatchedPath}`);
  // Limpieza en cualquier salida: la copia de prueba no debe quedar en el arbol ni
  // en el paquete (package.ps1 aborta si ve artefactos raros bajo runtime\browser).
  process.on("exit", () => {
    try {
      unlinkSync(unpatchedPath);
    } catch {}
  });
}

async function callListBrowsers(servicePath) {
  const repl = spawn(join(binDir, "node_repl.exe"), ["--disable-sandbox"], {
    env: {
      ...process.env,
      CODEX_HOME: homeDir,
      NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS: "1000",
      NODE_REPL_NODE_MODULE_DIRS: join(binDir, "node_modules"),
      NODE_REPL_NODE_PATH: join(binDir, "node.exe"),
      NODE_REPL_TRUSTED_CODE_PATHS: [homeDir, join(binDir, "node_modules"), browserDir].join(";"),
      NODE_REPL_TRUSTED_SERVICES: JSON.stringify({
        browser: servicePath.replaceAll("\\", "/"),
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
  let stderr = "";
  repl.stderr.on("data", (d) => (stderr += d.toString()));
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
  let id = 1;
  const rpc = (method, params) =>
    new Promise((res) => {
      const n = id++;
      repl.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
      pending.set(n, res);
      setTimeout(() => {
        if (pending.has(n)) {
          pending.delete(n);
          res({ timeout: true });
        }
      }, 90000);
    });
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: { elicitation: {} },
    clientInfo: { name: "ab-turn-metadata", version: "1.0.0" },
  });
  repl.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  const code =
    "let out={};try{const b=await import('browser');const l=await b.listBrowsers();out.count=l.length;}catch(e){out.error=String(e&&e.message);}nodeRepl.write(JSON.stringify(out));";
  // SIN `_meta["x-codex-turn-metadata"]`: es lo que manda un cliente que no es Codex.
  const res = await rpc("tools/call", { name: "js", arguments: { code, timeout_ms: 60000 } });
  const text = (res.result?.content ?? []).map((c) => c.text ?? "").join("\n").trim();
  repl.kill();
  return { text, stderr };
}

if (!existsSync(service)) {
  console.error("[FAIL] falta " + service);
  process.exit(1);
}

console.log("\n== A) SERVICIO SIN PARCHE (debe abortar por metadatos de turno) ==");
const withoutPatch = await callListBrowsers(unpatchedPath);
console.log("  crudo: " + withoutPatch.text.slice(0, 300));
const failedAsExpected = /Missing required Codex turn metadata/i.test(withoutPatch.text);
console.log(failedAsExpected ? "  [OK] sin parche aborta con el error exacto esperado" : "  [FAIL] sin parche NO aborto (la prueba A/B no discrimina)");

console.log("\n== B) SERVICIO CON PARCHE (debe funcionar) ==");
const withPatch = await callListBrowsers(service);
console.log("  crudo: " + withPatch.text.slice(0, 300));
let okB = false;
try {
  const parsed = JSON.parse(withPatch.text.slice(withPatch.text.indexOf("{")));
  okB = !parsed.error && parsed.count >= 0;
} catch {}
console.log(okB ? "  [OK] con parche listBrowsers responde sin metadatos de turno" : "  [FAIL] con parche sigue fallando");

if (failedAsExpected && okB) {
  console.log("\n  [OK] A/B correcto: el parche es necesario y suficiente.");
  process.exit(0);
}
console.log("\n--- stderr sin parche ---\n" + withoutPatch.stderr.slice(0, 800));
console.log("--- stderr con parche ---\n" + withPatch.stderr.slice(0, 800));
process.exit(1);
