// ComputerUser "sky guard": a drop-in replacement for the `sky` trusted RPC
// service (`@oai/sky/service`) that enforces the app allowlist and the
// non-negotiable prohibitions BEFORE the real Computer Use engine is invoked.
//
// WHY HERE (and not at the `@oai/sky` import site):
//   * `@oai/sky` (sky.js) never talks to the native engine directly: it calls
//     `nodeRepl.rpc("sky", { type: "execute", method, args })`.
//   * The node_repl kernel resolves the "sky" service from the
//     NODE_REPL_TRUSTED_SERVICES env var and loads the module's `handleRpc`
//     export (see the kernel's trusted-service host / loadHandler).
//   * Therefore `handleRpc` is the single, complete interception point: every
//     action of the public API ({sky} from "@oai/sky") reaches it, with the
//     method name and its arguments. The public API and its signatures stay
//     byte-for-byte identical for skill code.
//   * The kernel only imports files that live inside
//     NODE_REPL_TRUSTED_CODE_PATHS, so this module is loaded through the
//     `@computer-user/sky-guard` shim package inside
//     `runtime/bin/node_modules` (install.ps1 keeps it in sync, exactly like
//     the `browser` shim). If it cannot be loaded the kernel fails loudly
//     instead of silently falling back to the unguarded service.
//
// Fail-closed policy: any action whose target app cannot be resolved to an
// entry of `[apps] allowed` is rejected. Read-only methods are allowed but
// still logged.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REAL_SERVICE_SPECIFIER = "@oai/sky/service";

// ---------------------------------------------------------------------------
// Non-negotiable blacklist (mirrors the free-computer-user skill, section 0.1)
// ---------------------------------------------------------------------------
const BLACKLIST_EXE = new Set([
  "cmd.exe",
  "powershell.exe",
  "pwsh.exe",
  "windowsterminal.exe",
  "wt.exe",
  "wsl.exe",
  "bash.exe",
  "conhost.exe",
  "regedit.exe",
  "rundll32.exe",
  "mshta.exe",
  "cscript.exe",
  "wscript.exe",
  "taskmgr.exe",
]);

// Stems (name without `.exe`) so package-style ids that never spell out the
// extension still match: `Microsoft.Windows.cmd_8wekyb3d8bbwe!App` -> "cmd".
const BLACKLIST_STEMS = new Set(
  [...BLACKLIST_EXE].map((entry) => entry.replace(/\.exe$/i, "")),
);

// `press_key` tokens that would reach the OS-level shell shortcuts.
const BLACKLIST_KEY_TOKENS = new Set([
  "meta",
  "meta_l",
  "meta_r",
  "windows",
  "windows_l",
  "windows_r",
  "win",
  "cmd",
  "command",
  "super",
  "super_l",
  "super_r",
  "os",
]);
// `Control_L+Escape` (in any order) opens the Start menu on Windows.
const KEY_TOKEN_CONTROL = new Set(["control", "control_l", "control_r", "ctrl"]);
const KEY_TOKEN_ESCAPE = new Set(["escape", "esc"]);

// Methods that only observe. They are allowed (and logged) even though they
// still carry the app identity of an allowed target.
const READ_ONLY_METHODS = new Set(["list_apps", "list_windows"]);
// Methods that act on a specific window: `args[0]` carries the target window.
const WINDOW_METHODS = new Set([
  "get_window_state",
  "click",
  "press_key",
  "type_text",
  "set_value",
  "scroll",
  "drag",
  "perform_secondary_action",
  "activate_window",
  "get_window",
]);

// ---------------------------------------------------------------------------
// Install paths (CODEX_HOME is set by mcp_config.json)
// ---------------------------------------------------------------------------
const GUARD_FILE = fileURLToPath(import.meta.url);
const GUARD_DIR = dirname(GUARD_FILE);

function resolveHomeDir() {
  for (const key of ["CODEX_HOME", "COMPUTER_USER_HOME"]) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  // <install root>/runtime/bin/node_modules/@computer-user/sky-guard/index.mjs
  //                                   ^3      ^4         ^5        ^6
  try {
    return join(GUARD_DIR, "..", "..", "..", "..", "home");
  } catch {
    return null;
  }
}

const HOME_DIR = resolveHomeDir();
const CONFIG_PATH = HOME_DIR ? join(HOME_DIR, "computer-use", "config.toml") : "(CODEX_HOME is not set)";
const LOG_PATH = HOME_DIR ? join(HOME_DIR, "computer-use", "guard.log") : null;

// ---------------------------------------------------------------------------
// Logging (append-only, no sensitive data: no titles, no typed text, no paths)
// ---------------------------------------------------------------------------
function logDecision(entry) {
  if (!LOG_PATH) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, line + "\n", "utf8");
  } catch {
    // A failing log must never allow an action through; the decision itself is
    // already enforced and the kernel surfaces the thrown error.
    try {
      process.stderr.write("[sky-guard] could not write guard.log: " + line + "\n");
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// config.toml -> [apps] allowed
// ---------------------------------------------------------------------------
let configCache = null; // { entries, error }

function parseAllowedSection(text) {
  const entries = [];
  let section = "";
  let pendingBuffer = null; // non-null while a multi-line array is being read

  const completeArray = (buffer) => {
    if (!buffer.includes("]")) return false;
    const body = buffer.slice(0, buffer.indexOf("]"));
    for (const match of body.matchAll(/"([^"]*)"|'([^']*)'/g)) {
      const value = (match[1] ?? match[2] ?? "").trim();
      if (value) entries.push(value);
    }
    return true;
  };

  for (const rawLine of String(text).split(/\r?\n/)) {
    let line = rawLine;

    if (pendingBuffer !== null) {
      pendingBuffer += " " + line;
      if (completeArray(pendingBuffer)) pendingBuffer = null;
      continue;
    }

    if (line.includes("#")) line = line.slice(0, line.indexOf("#"));
    line = line.trim();
    if (!line) continue;

    const sectionMatch = /^\[([^\]]+)\]/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      continue;
    }

    const keyMatch = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line);
    if (!keyMatch) continue;
    if (section !== "apps") continue;
    const key = keyMatch[1].toLowerCase();
    if (key !== "allowed" && key !== "allowed_apps") continue;

    const value = keyMatch[2].trim();
    if (value.startsWith("[")) {
      if (!completeArray(value)) pendingBuffer = value;
    }
  }

  // Preserve document order, drop duplicates/empties.
  const seen = new Set();
  const unique = [];
  for (const entry of entries) {
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

function loadConfig() {
  if (configCache) return configCache;
  try {
    const entries = parseAllowedSection(readFileSync(CONFIG_PATH, "utf8"));
    configCache = { entries, error: null };
  } catch (error) {
    configCache = {
      entries: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return configCache;
}

// ---------------------------------------------------------------------------
// App identifier matching
//
// Why this is not a plain string comparison: the engine reports the same app in
// several shapes, e.g. `mspaint.exe`, `Microsoft.Paint_8wekyb3d8bbwe!App`,
// `process:C:\...\WINWORD.EXE` and `Microsoft.Office.WINWORD.EXE.15` (Word).
// The allowlist is written by humans (`winword.exe`), so matching must be
// version- and composite-aware. The blacklist uses EXACTLY the same
// normalization, and it is always evaluated first: deny wins over allow.
// ---------------------------------------------------------------------------
function normalizeIdentifier(value) {
  let candidate = String(value ?? "").trim();
  if (!candidate) return null;
  if (
    (candidate.startsWith('"') && candidate.endsWith('"') && candidate.length > 1) ||
    (candidate.startsWith("'") && candidate.endsWith("'") && candidate.length > 1)
  ) {
    candidate = candidate.slice(1, -1).trim();
  }
  if (!candidate) return null;
  // "process:C:\path\app.exe" -> "C:\path\app.exe"
  if (/^process:/i.test(candidate)) candidate = candidate.slice("process:".length).trim();
  // JSON-escaped separators ("C:\\Windows\\System32\\cmd.exe").
  candidate = candidate.replace(/\\\\/g, "\\");
  return candidate || null;
}

/** Basename used for matching, without forcing an extension. */
function basenameOf(value) {
  const parts = String(value).split(/[\\/]/);
  return parts[parts.length - 1].trim();
}

/**
 * Lower-cased match keys for an identifier or a configured entry, plus the
 * containment fragments used by the allowlist rule.
 *
 *   "winword.exe"                     -> keys ["winword.exe", "winword"]
 *                                        fragments ["winword"]
 *   "Microsoft.Office.WINWORD.EXE.15" -> keys ["microsoft.office.winword.exe.15",
 *                                        "microsoft.office", "office.winword",
 *                                        "winword.exe"]
 *                                        fragments ["microsoft", "office",
 *                                        "winword", "winword.exe"]
 *
 * Keys hold the full compound form (so a plain `winword.exe` still matches) and
 * every adjacent two-segment join with components of 2+ characters (so
 * `winword.exe` and `powershell.ise` match, while junk like `exe` or `15` does
 * not). This is what makes a composite engine id with a numeric version suffix
 * match a plain allowlist entry; the blacklist consumes the very same keys.
 */
function normalizedVariants(value) {
  const normalized = normalizeIdentifier(value);
  if (!normalized) return { normalized: null, keys: [], fragments: [] };

  const base = basenameOf(normalized).toLowerCase();
  const segments = base.split(/[._!]+/).filter(Boolean);
  const keys = [];
  const fragments = [];
  const pushKey = (key) => {
    if (key && !keys.includes(key)) keys.push(key);
  };
  const pushFragment = (fragment) => {
    if (fragment && !fragments.includes(fragment)) fragments.push(fragment);
  };

  pushKey(base);
  if (segments.length > 1) pushKey(segments.join("."));
  for (let start = 0; start < segments.length; start += 1) {
    const first = segments[start];
    pushFragment(first);
    if (start + 1 < segments.length) {
      const second = segments[start + 1];
      pushFragment(first + "." + second);
      if (first.length >= 2 && second.length >= 2) pushKey(first + "." + second);
    }
  }
  // The joined form of every segment is the version-stripped identity.
  if (segments.length > 1) pushFragment(segments.join("."));

  return { normalized, keys, fragments };
}

function entryKeys(entry) {
  return normalizedVariants(entry).keys;
}

/**
 * For an MSIX AUMID (`Microsoft.Paint_8wekyb3d8bbwe!App`) the fragment before
 * the `!` is the app-name component. The containment rule compares only that
 * component, so a different app from the same publisher
 * (`Microsoft.Windows.cmd_8wekyb3d8bbwe!App`) can never match Paint just
 * because both share the publisher hash.
 */
function entryAppComponent(entry) {
  const normalized = normalizeIdentifier(entry);
  if (!normalized) return null;
  const base = basenameOf(normalized).toLowerCase();
  if (!base.includes("!")) return null;
  return base.slice(0, base.indexOf("!"));
}

/**
 * Match a candidate identifier against the configured allowlist entries.
 * Accepts the three supported shapes (`app.exe`, full process path, MSIX AUMID)
 * plus composite engine ids with a numeric version suffix. Returns the matched
 * entry, or null (fail-closed).
 */
function matchEntry(candidate, entries) {
  const { normalized, keys, fragments } = normalizedVariants(candidate);
  if (!normalized) return null;
  const candidateKeys = new Set(keys);

  // 1. Exact / version-aware key equality on either side.
  for (const entry of entries) {
    if (entryKeys(entry).some((key) => candidateKeys.has(key))) {
      return { entry, rule: "key" };
    }
  }

  // 2. Containment: an entry whose basename appears as one of the candidate's
  //    fragments. Guards against an entry being a fragment of another entry by
  //    requiring, when the fragment itself splits into components, that one of
  //    the fragment's own keys is also present in the candidate keys.
  for (const entry of entries) {
    const entryBase = basenameOf(normalizeIdentifier(entry) ?? "").toLowerCase();
    if (!entryBase || entryBase.length < 3 || entryBase === "exe") continue;
    // An AUMID entry only matches through its app-name component.
    const aumidPart = entryAppComponent(entry);
    if (aumidPart !== null) {
      if (fragments.includes(aumidPart) || candidateKeys.has(aumidPart)) return { entry, rule: "containment" };
      continue;
    }
    if (!fragments.includes(entryBase)) continue;
    const entryBaseIsComposite = entryKeys(entry).some((key) => key.includes(".") && !key.startsWith(entryBase));
    if (entryBaseIsComposite && !candidateKeys.has(entryBase)) continue;
    return { entry, rule: "containment" };
  }

  return null;
}

/** True when the entry matched a composite engine id rather than a plain one. */
function compositeMatch(entry, candidate) {
  const { normalized } = normalizedVariants(candidate);
  if (!normalized) return false;
  const single = basenameOf(normalized).toLowerCase();
  return single !== String(entry).trim().toLowerCase();
}

/**
 * True when an identifier looks like a composite/package identity rather than a
 * plain executable name. Used to let the blacklist also inspect "bare" trailing
 * components: Word's `Microsoft.Office.WINWORD.EXE.15` is composite (4+ dotted
 * components) while a plain `cmd.exe` is not, so `cmd.exe` keeps matching by
 * key and `<something>.EXE.15` never blocks every app by its version suffix.
 */
function isCompositeIdentifier(candidate) {
  const { normalized } = normalizedVariants(candidate);
  if (!normalized) return false;
  const base = basenameOf(normalized).toLowerCase();
  const segments = base.split(/[._!]+/).filter(Boolean);
  if (segments.length < 3) return false;
  if (base.includes("!") || !base.includes(".")) return true;
  return segments.length >= 4;
}

/**
 * Blacklist lookup with the same normalization as the allowlist, and LESS
 * forgiving on purpose.
 *
 *   "cmd.exe"                                  -> key "cmd.exe"
 *   "C:\Windows\System32\CMD.EXE"              -> key "cmd.exe"
 *   "Microsoft.Office.CMD.EXE.15"              -> key "cmd.exe"
 *   "Microsoft.Windows.cmd_8wekyb3d8bbwe!App"  -> bare component "cmd" (composite id)
 *
 * Deny must never lose to allow, so a composite id carrying a bare forbidden
 * component is blocked even when it never spells out `.exe`.
 */
function findBlacklisted(candidate) {
  const { normalized, keys } = normalizedVariants(candidate);
  for (const key of keys) {
    if (BLACKLIST_EXE.has(key) || BLACKLIST_STEMS.has(key)) return key;
  }
  if (normalized && isCompositeIdentifier(candidate)) {
    const base = basenameOf(normalized).toLowerCase();
    const segments = base.split(/[._!]+/).filter(Boolean);
    for (const segment of segments) {
      if (segment.length >= 2 && (BLACKLIST_EXE.has(segment) || BLACKLIST_STEMS.has(segment))) return segment;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Guard errors
// ---------------------------------------------------------------------------
function allowlistError(candidate) {
  return (
    `Computer Use was not approved to use "${candidate}". ` +
    `Añádelo a home\\computer-use\\config.toml ([apps] allowed) si de verdad quieres permitirlo ` +
    `(vale tanto "app.exe" como un AUMID tipo "Microsoft.Paint_8wekyb3d8bbwe!App").`
  );
}

function blacklistError(candidate) {
  return (
    `"${candidate}" está prohibido por política de ComputerUser y no se puede habilitar: ` +
    `las terminales/shells y las herramientas de sistema (` +
    `cmd.exe, powershell.exe, pwsh.exe, WindowsTerminal.exe, wt.exe, wsl.exe, bash.exe, conhost.exe, ` +
    `regedit.exe, rundll32.exe, mshta.exe, cscript.exe, wscript.exe, taskmgr.exe) no se automatizan nunca. ` +
    `No lo añadas a [apps] allowed: la guardia lo seguirá bloqueando.`
  );
}

function keyError(key, reason) {
  return (
    `press_key("${key}") está prohibido por política de ComputerUser: ${reason}. ` +
    `Nunca se envían las teclas Meta/Windows/Win/Cmd/Super/OS ni la combinación Control+Escape ` +
    `(menú Inicio / atajos del sistema). Usa el árbol de accesibilidad y atajos dentro de la app.`
  );
}

function unknownTargetError(method) {
  return (
    `Computer Use was not approved to run "${method}": no pude determinar la app objetivo ` +
    `(falta un identificador de app en el objeto window). Pasa un window devuelto por list_apps()/list_windows() ` +
    `o el campo app con un identificador listado en home\\computer-use\\config.toml ([apps] allowed).`
  );
}

function configUnavailableError() {
  const detail = configCache?.error ? ` (${configCache.error})` : "";
  return (
    `Computer Use was not approved: no se pudo leer la allowlist en "${CONFIG_PATH}"${detail}. ` +
    `Sin allowlist legible la guardia bloquea toda acción; revisa el fichero y vuelve a intentarlo.`
  );
}

// ---------------------------------------------------------------------------
// Argument inspection
// ---------------------------------------------------------------------------
function firstArg(args) {
  return Array.isArray(args) && args.length > 0 ? args[0] : undefined;
}

function isWindowLike(value) {
  return Boolean(value) && typeof value === "object";
}

/**
 * Resolve the acting app for a window method. `window.app` wins over the
 * optional top-level `app` because that is the field the real service prefers
 * (`f(window)` in computer_use_client_base.js).
 */
function extractWindowApp(arg) {
  if (!isWindowLike(arg)) return { app: null, window: null };
  const window = isWindowLike(arg.window) ? arg.window : null;
  const fromWindow = normalizeIdentifier(window?.app);
  const fromArg = normalizeIdentifier(arg.app);
  return { app: fromWindow ?? fromArg, window };
}

function checkKey(key) {
  const raw = String(key ?? "");
  if (!raw.trim()) return { ok: false, reason: "la tecla está vacía" };
  const normalized = raw.replace(/\s+/g, "").toLowerCase();
  const tokens = normalized.split("+").filter(Boolean);
  for (const token of tokens) {
    if (BLACKLIST_KEY_TOKENS.has(token)) {
      return { ok: false, reason: `el modificador "${token}" es la tecla Windows/Meta` };
    }
  }
  // Control+Escape in any order (Control_L+Escape, Escape+Control_L, ...).
  if (tokens.some((token) => KEY_TOKEN_CONTROL.has(token)) && tokens.some((token) => KEY_TOKEN_ESCAPE.has(token))) {
    return { ok: false, reason: "Control+Escape abre el menú Inicio" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------
function decide(request) {
  const method = String(request?.method ?? "");
  const args = request?.args;

  if (READ_ONLY_METHODS.has(method)) {
    return { decision: "allow", app: null, reason: "lectura" };
  }

  const config = loadConfig();
  if (config.error) {
    return { decision: "deny", app: null, error: configUnavailableError(), reason: "allowlist ilegible" };
  }

  let candidate = null;
  if (method === "launch_app") {
    candidate = normalizeIdentifier(firstArg(args)?.app);
    if (!candidate) {
      return { decision: "deny", app: null, error: unknownTargetError(method), reason: "sin app objetivo" };
    }
  } else if (WINDOW_METHODS.has(method)) {
    const { app } = extractWindowApp(firstArg(args));
    candidate = app;
    if (!candidate) {
      return { decision: "deny", app: null, error: unknownTargetError(method), reason: "sin app objetivo" };
    }
  } else {
    // Unknown/extra methods (drag_handle transport, audio, ...): fail closed
    // unless they carry a window we can identify.
    const { app } = extractWindowApp(firstArg(args));
    if (!app) {
      return { decision: "deny", app: null, error: unknownTargetError(method), reason: "método no reconocido" };
    }
    candidate = app;
  }

  if (candidate && basenameOf(candidate) === candidate && !candidate.includes(".") && !candidate.includes("!")) {
    // Not a plausible executable name nor an AUMID (e.g. a bare drive letter).
    candidate = null;
  }

  // 1. Non-negotiable blacklist first (same normalization): deny > allow.
  const blacklisted = findBlacklisted(candidate);
  if (blacklisted) {
    return { decision: "deny", app: candidate, error: blacklistError(blacklisted), reason: "lista negra" };
  }

  // 2. Allowlist.
  const matched = matchEntry(candidate, config.entries);
  if (!matched) {
    return { decision: "deny", app: candidate, error: allowlistError(basenameOf(candidate) || candidate), reason: "fuera de allowlist" };
  }

  // 3. Key chords.
  if (method === "press_key") {
    const key = firstArg(args)?.key;
    const verdict = checkKey(key);
    if (!verdict.ok) {
      return { decision: "deny", app: candidate, error: keyError(key, verdict.reason), reason: "tecla prohibida" };
    }
  }

  const composite = compositeMatch(matched.entry, candidate);
  const rule = composite ? `${matched.rule} (id compuesto)` : matched.rule;
  return {
    decision: "allow",
    app: candidate,
    matched: matched.entry,
    reason: `allowlist/${rule}`,
  };
}

// ---------------------------------------------------------------------------
// Real service loading (lazy, loud on failure)
// ---------------------------------------------------------------------------
let realServicePromise = null;

function loadRealService() {
  if (!realServicePromise) {
    realServicePromise = import(REAL_SERVICE_SPECIFIER).catch((error) => {
      realServicePromise = null;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `SKY-GUARD: no pude cargar el servicio real "${REAL_SERVICE_SPECIFIER}" (${detail}). ` +
          `La automatización se detiene en vez de continuar sin guardia.`,
      );
    });
  }
  return realServicePromise;
}

async function realHandleRpc(request) {
  const module = await loadRealService();
  if (typeof module.handleRpc !== "function") {
    throw new Error(`SKY-GUARD: "${REAL_SERVICE_SPECIFIER}" no exporta handleRpc`);
  }
  return module.handleRpc(request);
}

// ---------------------------------------------------------------------------
// Public entry point expected by the node_repl kernel
// ---------------------------------------------------------------------------
export async function handleRpc(request) {
  const type = request?.type;

  if (type === "setup") {
    // Force loading the real service so a broken guard fails visibly here
    // instead of degrading silently on the first action.
    await loadRealService();
    return realHandleRpc(request);
  }

  if (type !== "execute") {
    // drag_start / drag_move / drag_end are Linux-only transport messages.
    logDecision({ method: type ?? "unknown", decision: "allow", reason: "transporte" });
    return realHandleRpc(request);
  }

  const verdict = decide(request);
  logDecision({ method: request.method, app: verdict.app, decision: verdict.decision, reason: verdict.reason });

  if (verdict.decision === "deny") {
    throw new Error(verdict.error);
  }
  return realHandleRpc(request);
}
