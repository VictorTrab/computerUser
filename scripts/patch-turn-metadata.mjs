#!/usr/bin/env node
// Wrapper de conveniencia. La implementacion real (y la que reutiliza el
// instalador) vive en runtime\browser\patch-turn-metadata.mjs, que SI viaja en el
// release; `scripts\package.ps1` no se distribuye, asi que aqui no puede haber
// logica que el instalador necesite.
//
// Este fichero solo reexporta y, si se ejecuta directamente, delega en el modulo
// real. Incluso `import` de este wrapper ejecuta el modulo real (es el mismo grafo de
// modulos); el modulo real solo actua por si mismo si ES el punto de entrada, asi que
// sin esta delegacion `node scripts\patch-turn-metadata.mjs <copias>` saldria con 0
// SIN parchear nada (trampa silenciosa: el instalador llama al modulo real, pero el
// README documenta este wrapper).
import { fileURLToPath } from "node:url";
import {
  TURN_METADATA_PATCH_MARKER,
  TURN_METADATA_INJECTED,
  patchTurnMetadataFile,
} from "../runtime/browser/patch-turn-metadata.mjs";

export { TURN_METADATA_PATCH_MARKER, TURN_METADATA_INJECTED, patchTurnMetadataFile };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("Uso: node scripts\\patch-turn-metadata.mjs <browser-service.mjs> [...]");
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
      const extra = result.migrated ? ` [migrado: ${result.migrated}]` : ` (guardia ${result.guard}, lector ${result.reader})`;
      console.log(`[OK] parcheado: ${file}${extra}`);
    } else if (result.status === "already-patched") {
      console.log(`[OK] ya parcheado: ${file}`);
    } else {
      console.error(`[FALLO] ${result.status}: ${file}`);
      failures++;
    }
  }
  process.exit(failures > 0 ? 1 : 0);
}
