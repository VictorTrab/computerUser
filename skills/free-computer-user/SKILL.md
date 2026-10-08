---
name: free-computer-user
description: Control and automate Windows desktop application windows using the native @oai/sky engine.
---

# Windows Desktop Automation (`free-computer-user`)

Execute persistent JavaScript via the `js` MCP tool to inspect and automate Windows application windows.

## 1. Initialization

```js
if (!globalThis.sky) {
  const { sky } = await import("@oai/sky");
  globalThis.sky = sky;
}
```

## 2. API Reference (`sky`)

### List Applications & Windows
```js
const apps = await sky.list_apps();
const windows = await sky.list_windows();
nodeRepl.write(JSON.stringify(windows, null, 2));
```
*(Target applications must be listed in `home/computer-use/config.toml` under `[apps] allowed`. If missing, append the executable name, e.g., `"app.exe"`, to the allowlist before interacting).*

### Launch Application
```js
await sky.launch_app({ app: "calc.exe" });
```

### Capture Window State
```js
const state = await sky.get_window_state({
  window: targetWindow,
  include_screenshot: true,
  include_text: true
});
nodeRepl.write(JSON.stringify(state.accessibility, null, 2));
```

### Interact with Elements
```js
// Click by UI Automation element index (preferred)
await sky.click({ window: targetWindow, element_index: 5 });

// Click by window-relative coordinates
await sky.click({ window: targetWindow, x: 140, y: 220, click_count: 1 });

// Set text value directly on an editable element
await sky.set_value({ window: targetWindow, element_index: 3, value: "TEXT" });

// Type text into current keyboard focus
await sky.type_text({ window: targetWindow, text: "text" });

// Send key or key combination (e.g., Return, Tab, Control_L+a, Alt+F4)
await sky.press_key({ window: targetWindow, key: "Return" });

// Scroll within window
await sky.scroll({ window: targetWindow, x: 200, y: 300, scrollX: 0, scrollY: 400 });
```

### Focus Window
```js
await sky.activate_window({ window: targetWindow });
```

## Guidelines
- Prefer UI Automation element indices (`element_index`) over raw `(x, y)` coordinates to ensure stability across display scalings and window positions.
- Refresh window state via `sky.get_window_state` following actions that mutate the user interface.
