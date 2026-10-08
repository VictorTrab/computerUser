// Minimal JSONL protocol tracer. Every frame that crosses the host is appended
// with direction, byte length and the parsed JSON (payloads are truncated).
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createTrace(path, { enabled = path != null, maxPayloadChars = 4000 } = {}) {
  if (enabled && path) {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {}
  }
  const t0 = Date.now();
  return {
    path,
    enabled,
    /** direction: "browser->host" | "host->browser" | "pipe->host" | "host->pipe" | "host:local" | "note" */
    log(direction, detail) {
      if (!enabled || !path) return;
      let payload;
      try {
        payload = typeof detail === "string" ? detail : JSON.stringify(detail);
      } catch {
        payload = String(detail);
      }
      if (payload != null && payload.length > maxPayloadChars) {
        payload = payload.slice(0, maxPayloadChars) + `…(+${payload.length - maxPayloadChars} chars)`;
      }
      const line = JSON.stringify({ t: Date.now() - t0, dir: direction, payload });
      try {
        appendFileSync(path, line + "\n");
      } catch {}
    },
  };
}
