// Comprueba que todos los ficheros declarados en el manifest existen.
// Evita releases con la extension rota (Chrome no la carga si falta un script declarado).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
if (!dir) { console.error("uso: node check-extension-files.mjs <carpeta-extension>"); process.exit(2); }
const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const files = [];
for (const cs of m.content_scripts ?? []) for (const f of [...(cs.js ?? []), ...(cs.css ?? [])]) files.push(f);
for (const f of Object.values(m.icons ?? {})) files.push(f);
if (m.action?.default_icon) for (const f of Object.values(m.action.default_icon)) files.push(f);
for (const k of ["default_popup", "default_page"]) if (m.action?.[k]) files.push(m.action[k]);
if (m.side_panel?.default_path) files.push(m.side_panel.default_path);
if (m.options_page) files.push(m.options_page);
if (m.options_ui?.page) files.push(m.options_ui.page);
if (m.devtools_page) files.push(m.devtools_page);
for (const war of m.web_accessible_resources ?? []) for (const f of war.resources ?? []) if (!f.includes("*")) files.push(f);
const missing = [...new Set(files)].filter((f) => !existsSync(join(dir, f)));
if (missing.length) { console.error("[FALLO] el manifest declara ficheros que no existen: " + missing.join(", ")); process.exit(1); }
console.log("[OK] manifest coherente: " + new Set(files).size + " ficheros declarados, todos presentes");