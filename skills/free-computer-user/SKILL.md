---
name: free-computer-user
description: Control and automate Windows desktop application windows using the native @oai/sky engine.
---

# Windows Desktop Automation (`free-computer-user`)

Execute persistent JavaScript via the `js` MCP tool to automate Windows desktop apps via UI Automation and `Windows.Graphics.Capture`.

## 1. Initialization & App Selection

Import `@oai/sky`, list installed apps or open windows, and select the target window.

```js
var sky = (globalThis.sky ??= (await import("@oai/sky")).sky);

var apps = await sky.list_apps();
var targetApp = apps.find((app) =>
  /calculator|calc|notepad|replace-with-app-name/i.test(String(app.id) + " " + String(app.displayName || ""))
);

if (!targetApp) {
  // Query open windows directly if app metadata is missing
  var windows = await sky.list_windows();
  var targetWindow = windows.find(w => /calc|notepad/i.test(w.title || ""));
} else if (targetApp.windows.length === 0) {
  // Launch if no window is currently open
  await sky.launch_app({ app: targetApp.id });
  apps = await sky.list_apps();
  targetApp = apps.find(a => a.id === targetApp.id);
  var targetWindow = await sky.get_window(targetApp.windows[0]);
} else {
  var targetWindow = await sky.get_window(targetApp.windows[0]);
}

await sky.activate_window({ window: targetWindow });
```
*(Applications must be listed in `home/computer-use/config.toml` under `[apps] allowed`. If missing, append the executable name, e.g., `"app.exe"`, to the allowlist before interacting).*

## 2. Capturing Window State

State capture uses `Windows.Graphics.Capture`, allowing window inspection even when occluded or behind other apps.

```js
var state = await sky.get_window_state({
  window: targetWindow,
  include_screenshot: true,
  include_text: true,
});
targetWindow = state.window;

// 1. Semantic Accessibility Tree (elements and indices)
nodeRepl.write(String(state.accessibility?.tree || ""));

// 2. Document Text (for text-heavy apps like Notepad, WordPad, editors)
if (state.accessibility?.document_text) {
  nodeRepl.write(state.accessibility.document_text);
}
```

## 3. Semantic UI Automation (Preferred)

Always prioritize semantic element indices (`element_index`) over raw coordinates for resilience against display scaling and window movement.

```js
// Click by UI Automation element index
await sky.click({ window: targetWindow, element_index: 5 });

// Directly replace value in editable fields
await sky.set_value({ window: targetWindow, element_index: 12, value: "Hello World" });

// Secondary actions on expandable controls (ComboBox, TreeView, menus)
// Actions: "Expand", "Collapse", "Scroll Up", "Scroll Down", "Raise"
await sky.perform_secondary_action({
  window: targetWindow,
  element_index: 8,
  action: "Expand",
});
```

## 4. Coordinate Actions with `screenshotId`

When UI Automation elements are unavailable, use window-relative coordinates bound to the active `screenshotId`.

```js
var screenshotId = state.screenshots?.[0]?.id;

// Click by coordinates with screenshotId validation
await sky.click({ window: targetWindow, screenshotId, x: 400, y: 300, click_count: 1 });

// Drag and drop / slider adjustment
await sky.drag({
  window: targetWindow,
  screenshotId,
  from_x: 200,
  from_y: 300,
  to_x: 400,
  to_y: 300,
});

// Scroll window contents
await sky.scroll({ window: targetWindow, screenshotId, x: 400, y: 300, scrollX: 0, scrollY: 600 });
```

## 5. Keyboard Chords & Action Batching

Batch sequential keyboard inputs together before capturing a new state snapshot to minimize latency.

```js
// Standard keys: Return, Tab, space, Escape, BackSpace, Delete, Home, End
// Key chords: Control_L+a, Control_L+c, Control_L+v, Alt+F4, Control_L+Shift_L+z
await sky.set_value({ window: targetWindow, element_index: 1, value: "User" });
await sky.press_key({ window: targetWindow, key: "Tab" });
await sky.type_text({ window: targetWindow, text: "Password" });
await sky.press_key({ window: targetWindow, key: "Return" });

// Verify state once after the batch of actions completes
state = await sky.get_window_state({ window: targetWindow, include_screenshot: true, include_text: true });
```

## 6. Dialog, Modal & Focus Recovery

- **Modal & Child Windows:** If an action opens a dialog (e.g. "Save As", "Open File", confirm box), the parent window blocks. Call `sky.list_windows()` to find the newly opened child window and capture state on it directly.
- **Taskbar / Start Menu Collision:** If an input error indicates the coordinate fell on `StartMenuExperienceHost.exe`, call `await sky.activate_window({ window: targetWindow })`, refresh window state, and retry once.
- **Lost Window Binding:** If an existing window reference invalidates, rehydrate it using `sky.get_window({ id: targetWindow.id, app: targetWindow.app })`.
