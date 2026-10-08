# Operational Governance & Execution Policy

This policy defines mandatory execution standards, safety boundaries, and operating constraints for local desktop and browser automation.

---

## 1. Application Access & Process Governance

- **Enforced Process Allowlist:** All target processes and Application User Model IDs (AUMIDs) must match an authorized entry in `home/computer-use/config.toml`. Interactions with unlisted executables are rejected by policy.
- **Dynamic Allowlist Updates:** When automation requires access to an unlisted user-requested application:
  1. Identify the binary executable filename (e.g., `app.exe`).
  2. Add the entry to `[apps] allowed` in `home/computer-use/config.toml`.
  3. Resume execution immediately.
- **Restricted System Boundaries:**
  - Never add to the allowlist or interact with administrative or sensitive security targets: `regedit.exe`, disk/partition managers, User Account Control elevation dialogs (`Consent.exe`), credential managers, or financial services.

---

## 2. Desktop Automation Standards (`@oai/sky`)

- **Semantic Prioritization (UI Automation):** Prefer semantic accessibility indices (`element_index`) and direct value updates (`set_value`) over absolute coordinate clicks `(x, y)`. Semantic elements remain stable across window resizing, display scaling, and multi-monitor setups.
- **State Invalidation & Refresh:** Treat window states as point-in-time snapshots. Always refresh state after performing mutating interactions (clicks, keyboard input, hotkeys):
  ```js
  const state = await sky.get_window_state({ window: targetWindow, include_screenshot: true, include_text: true });
  ```
- **Process Discovery:** If the target window is absent in `sky.list_windows()`, launch the process via `sky.launch_app({ app: "..." })` or the system environment, allow standard initialization time, and query `sky.list_windows()` before proceeding.

---

## 3. Browser Automation Standards (`browser`)

- **Lightweight Semantic Inspection:** Use `tab.accessibility.snapshot()` and Playwright selector engines (`tab.playwright.click`, `tab.playwright.fill`) as primary methods instead of visual OCR or full-screen captures.
- **Local Scheme Support:** Use `file://` and `localhost` schemes for local document inspection, staging builds, and verification workflows.

---

## 4. Irreversible Actions & User Safeguards

- **Mandatory Confirmation Required:** Require explicit user authorization prior to:
  1. Permanent deletion of files, directories, repositories, or databases.
  2. Sending external messages, publishing content, or transmitting unreviewed communications.
  3. Executing monetary transactions, license activations, or credential approvals.
