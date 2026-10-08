// ComputerUser patch: turn metadata por defecto para clientes MCP NO-Codex.
//
// POR QUE EXISTE
// `browser-service.mjs` exige `_meta["x-codex-turn-metadata"]` con `session_id` y
// `turn_id` en cada `tools/call`. Solo los clientes de Codex lo envian; un cliente
// MCP estandar (Antigravity, Cursor, cualquier cliente sobre el SDK de Go) NO, y el
// servicio aborta con `Missing required Codex turn metadata: session_id, turn_id`
// antes de llegar siquiera a descubrir el navegador. El error lo lanza una unica
// guardia minificada, cuya forma es identica en las tres copias del servicio
// (runtime\browser, @oai/browser-desktop y @oai/cua), solo cambian los nombres:
//
//     function XX(t){let e=YY(t);return["session_id","turn_id"]
//       .filter(n=>typeof e?.[n]!="string")}
//     function ZZ(t){let e=XX(t);if(e.length!==0)throw new Error(
//       `Missing required Codex turn metadata: ${e.join(", ")}`)}
//
// El parche NO relaja nada cuando los metadatos SI vienen: si vienen, se usan tal
// cual. Solo rellena los que falten. Cuando el lector no devuelve objeto (el cliente
// no envio nada o el JSON era invalido) se escribe el objeto COMPLETO en
// `requestMeta["x-codex-turn-metadata"]`, no solo el resultado del filtro, para que
// las demas lecturas del servicio (`gt`, `Nte`, `ku`, `Du`, el gate de browser-auth)
// vean exactamente los mismos valores que la guardia que acaba de pasar.
//
// ALCANCE REAL DEL PARCHE (medido en la v1.0.12)
// El parche evita el aborto de la guardia, pero NO basta para automatizar el navegador
// sin metadatos: las lecturas internas (`getSessionParams`) siguen viendo el
// `requestMeta` del RPC, no el objeto que la guardia relleno, asi que un cliente que no
// manda `_meta` no puede cerrar su turno (ni con `turn_ended` ni con el hook nativo de
// Computer Use: los dos son sensibles al `turn_id`). Para eso esta el puente
// `runtime\bin\mcp-bridge.mjs`, que inyecta metadatos de verdad en cada `tools/call`.
//
// Es idempotente: si el fichero ya lleva el parche, no se toca (mismo hash), que es
// requisito para que el instalador pueda ejecutarse dos veces sin efectos.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TURN_METADATA_PATCH_MARKER = "ComputerUser patch: default turn metadata";

const PATTERN =
  /function (\w+)\(t\)\{let e=(\w+)\(t\);return\["session_id","turn_id"\]\.filter\(n=>typeof e\?\.\[n\]!="string"\)\}/;

// Snippet inyectado por el parche. Se exporta porque el verificador A/B
// (`scripts\verify-turn-metadata-patch.mjs`) reconstruye la copia SIN parche quitando
// exactamente este texto: una sola fuente de verdad, imposible que se desincronicen.
export const TURN_METADATA_INJECTED =
  'if(e==null||typeof e!="object"||Array.isArray(e)){e={session_id:"default-mcp-session",turn_id:"turn-"+Date.now(),thread_source:"user"};' +
  'if(t!=null&&t.requestMeta!=null&&typeof t.requestMeta=="object"){try{t.requestMeta["x-codex-turn-metadata"]=JSON.stringify(e)}catch{}}}' +
  'if(typeof e.session_id!="string"||e.session_id===""){e.session_id="default-mcp-session"}' +
  'if(typeof e.turn_id!="string"||e.turn_id===""){e.turn_id="turn-"+Date.now()}';

// La guardia original se sustituye por: valores por defecto + la MISMA comprobacion
// final (si algo sigue sin ser string, `yR`/`TI`/`Sk` lanza su error de siempre).
function buildReplacement(checkFn, readFn) {
  return `function ${checkFn}(t){/* ${TURN_METADATA_PATCH_MARKER} */let e=${readFn}(t);${TURN_METADATA_INJECTED}return["session_id","turn_id"].filter(n=>typeof e?.[n]!="string")}`;
}

// Latin-1 a proposito: el servicio es un bundle minificado con secuencias UTF-8
// multibyte (emojis en instrucciones). Leer y reescribir en latin1 hace el
// reemplazo BYTE a BYTE, sin recodificar nada ni tocar los finales de linea.
export function patchTurnMetadataFile(file) {
  const text = readFileSync(file, "latin1");
  if (text.includes(TURN_METADATA_PATCH_MARKER)) {
    return { file, status: "already-patched" };
  }
  const match = PATTERN.exec(text);
  if (!match) {
    return { file, status: "pattern-not-found" };
  }
  if (text.split(match[0]).length - 1 !== 1) {
    return { file, status: "ambiguous" };
  }
  writeFileSync(file, text.replace(match[0], buildReplacement(match[1], match[2])), "latin1");
  return { file, status: "patched", guard: match[1], reader: match[2] };
}

// Ejecutable: `node patch-turn-metadata.mjs <fichero...>`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("Uso: node patch-turn-metadata.mjs <fichero.mjs> [...]");
    process.exit(2);
  }
  let failures = 0;
  for (const file of targets) {
    let result;
    try {
      result = patchTurnMetadataFile(file);
    } catch (err) {
      console.error(`[FALLO] no se pudo leer ${file}: ${err.message}`);
      failures++;
      continue;
    }
    if (result.status === "patched") {
      console.log(`[OK] parcheado: ${file} (guardia ${result.guard}, lector ${result.reader})`);
    } else if (result.status === "already-patched") {
      console.log(`[OK] ya parcheado: ${file}`);
    } else {
      console.error(`[FALLO] ${result.status}: ${file}`);
      failures++;
    }
  }
  if (failures > 0) {
    console.error(`${failures} fichero(s) sin parchear.`);
    process.exit(1);
  }
  process.exit(0);
}
