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
- **Secondary Actions for Expandable Controls:** Use `sky.perform_secondary_action({ window, element_index, action: "Expand" | "Collapse" | "Scroll Up" | ... })` for comboboxes, tree views, accordions, and menus rather than blind coordinate clicks.
- **Coordinate Actions with `screenshotId`:** When coordinate interactions `(x, y)` are necessary, always bind `screenshotId: state.screenshots?.[0]?.id` to prevent drift if the window shifts or resizes between capture and input.
- **Action Batching:** Batch related sequential inputs (e.g. `set_value`, `press_key({ key: "Tab" })`, `type_text`) before requesting a new `get_window_state()` snapshot to optimize responsiveness.
- **Document Text Reading:** In text-heavy applications (editors, viewers, log viewers), inspect `state.accessibility?.document_text` directly rather than traversing deep UI element trees.
- **Modal & Child Dialog Handling:** When an action spawns a modal or child dialog (e.g., "Save As", "Open File", confirm prompts), query `sky.list_windows()` to acquire the newly opened child window and redirect `get_window_state()` to it.
- **Focus Recovery (`StartMenuExperienceHost.exe`):** If an input error indicates that the coordinate is over a system window or taskbar (`StartMenuExperienceHost.exe`), call `await sky.activate_window({ window: targetWindow })`, refresh window state, and retry the interaction once.
- **State Invalidation & Refresh:** Treat window states as point-in-time snapshots. Always refresh state after performing mutating interactions to verify outcomes:
  ```js
  const state = await sky.get_window_state({ window: targetWindow, include_screenshot: true, include_text: true });
  ```
- **Process Discovery:** If the target window is absent in `sky.list_windows()`, launch the process via `sky.launch_app({ app: "..." })` or the system environment, allow standard initialization time, and query `sky.list_windows()` before proceeding.

---

## 3. Browser Automation Standards (`browser`)

- **Dedicated Tab Group Session:** Always group automation tabs using `await b.nameSession("Descriptive Task Title")` to isolate agent tabs visually and operationally from personal user tabs.
- **Tab Lifecycle Management:**
  - **Deliverable Tabs (`tab.markDeliverable()`):** Tabs containing final requested deliverables (reports, completed forms, purchase/task confirmations) must be marked to keep them and the tab group open when the turn completes.
  - **Handoff Tabs (`tab.markHandoff()` / `tab.requestManualHandoff()`):** Tabs requiring user intervention (2FA, CAPTCHA, manual payment entry) must be marked, focused, and handed off without closing.
  - **Ephemeral Tabs (`tab.close()`):** Intermediate throwaway tabs used for quick queries or discarded searches must be explicitly closed before finishing to avoid polluting the browser.
  - **Pre-existing User Tabs:** Tabs claimed via `b.user.claimTab(...)` must NEVER be closed; they are simply released upon completion.
- **Economic State Inspection:**
  - Prioritize accessibility trees and locators (`tab.playwright.locator(...)` or `tab.domSnapshot()`) for element interaction and text reading.
  - Reserve `tab.screenshot()` strictly for visual design verification, layout validation, or when visual confirmation is explicitly requested. Do not request both DOM snapshots and screenshots simultaneously by default.
- **Redundant Navigation Prevention:**
  - Check `await tab.url()` before navigating. If the tab is already on the target URL, do not execute `tab.goto(url)` to preserve session state, form inputs, and scroll position. Use `tab.reload()` only when explicitly required to refresh data.
- **Focused Navigation & Anti-looping:**
  - Perform direct and targeted queries. If a navigation or selector fails, evaluate alternatives rather than entering blind retry loops with minute URL tweaks.

---

## 4. Security, Confirmation Matrix & Human Handoff

- **Pre-Approved (Autonomous execution without confirmation):**
  - Dismissing or accepting standard cookie consent notices and privacy banners.
  - Accepting terms of service required for the user-requested task.
  - Downloading files explicitly requested by the user.
- **Mandatory User Authorization (Explicit confirmation required before action):**
  - Permanent deletion of files, directories, databases, accounts, or records.
  - Sending external communications, publishing public posts, or unreviewed emails.
  - Executing monetary transactions, purchases, or license activations.
  - Modifying account credentials or critical security settings.
- **Strict Human Handoff (Never automated, must transfer control to the user):**
  - Account password changes or master password updates.
  - Bypassing browser SSL/TLS certificate warnings or insecure connection alerts.
  - Completing biometric prompts or hardware security key challenges (WebAuthn/FIDO).

---

## 5. Visual Evidence Reporting

- When capturing visual screenshots as verification or deliverable proof for the user, embed the image directly in Markdown (`![captura](ruta_o_uri)`) in the response instead of outputting raw disk paths or plaintext links.
