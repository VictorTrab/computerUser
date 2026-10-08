# AI Agent Guidelines & Safety Policy

This document governs the operational behavior and security constraints for any AI agent (Cursor, Cline, OpenCode, DeepSeek Harness, Antigravity, etc.) interacting with the local `computerUser` automation engine.

---

## 1. Application Access Policy (Security Allowlist)

- **Process Filtering:** The Windows native engine verifies the process name or Application User Model ID (AUMID) of target windows against the allowlist located in `home/computer-use/config.toml`. Any attempt to interact with an unlisted executable is rejected by system policy.
- **Dynamic Allowlist Expansion:** If the user requests automation of a legitimate application that is not currently listed (e.g., an internal line-of-business app, graphics editor, media player, etc.):
  1. Determine the process executable name (e.g., `app.exe`).
  2. Append `"app.exe"` to the `[apps] allowed` array in `home/computer-use/config.toml`.
  3. Proceed with automation without unnecessary user interruption.
- **Strict Security Boundaries:**
  - **NEVER** add to the allowlist or interact with critical system management utilities: `regedit.exe`, disk management tools, Windows User Account Control elevation dialogs (`Consent.exe`), password managers, or financial banking applications.

---

## 2. Desktop UI Automation Best Practices (`@oai/sky`)

- **Semantic Prioritization (UIA):** Always prefer interacting via accessibility element indices (`element_index`) and direct value replacement (`set_value`) before falling back to window-relative coordinates `(x, y)`. Semantic elements remain stable across resolution shifts, window repositions, and DPI scaling changes.
- **Verification Loop:** Treat `sky.get_window_state` as an instantaneous snapshot. Refresh the window state with:
  ```js
  const state = await sky.get_window_state({ window: targetWindow, include_screenshot: true, include_text: true });
  ```
  after any action that mutates the UI (clicks, typing, shortcut keys) to verify the result before deciding the subsequent step.
- **Window Discovery:** If the target application window is not found in `sky.list_windows()`, launch it via `sky.launch_app({ app: "..." })` or the system shell, wait briefly for initialization, and refresh `sky.list_windows()` before proceeding.

---

## 3. Web Browser Navigation Best Practices (`browser`)

- **Lightweight Semantic Snapshots:** Prefer `tab.accessibility.snapshot()` and Playwright selector methods (`tab.playwright.click`, `tab.playwright.fill`) over heavy full-page screenshot streaming and OCR.
- **Local Development Support:** Use `file://` URLs for inspecting local documentation, HTML builds, and test files.

---

## 4. Safeguards for Irreversible Actions

- **Explicit User Confirmation Required:** You must seek explicit user confirmation before:
  1. Permanently deleting files, databases, or project repositories.
  2. Sending non-draft emails, posting publicly on social platforms, or messaging external channels.
  3. Executing monetary transactions or credential approval flows.
