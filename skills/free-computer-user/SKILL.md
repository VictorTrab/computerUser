---
name: free-computer-user
description: Automate Windows desktop applications (native Win32, UWP apps, PySide, dialogs) using the @oai/sky engine via the local node_repl MCP server.
---

# Windows Desktop Automation (`free-computer-user`)

Use the `mcp__computer_user__js` tool (or `js` depending on the harness) to execute persistent JavaScript code controlling Windows application windows via `@oai/sky`.

## 1. Initialization (Once per session)

```js
if (!globalThis.sky) {
  const { sky } = await import("@oai/sky");
  globalThis.sky = sky;
}
```

## 2. Core Workflow & API (`sky`)

1. **List running applications and open windows:**
   ```js
   const apps = await sky.list_apps();
   const windows = await sky.list_windows();
   nodeRepl.write(JSON.stringify(windows, null, 2));
   ```
   *(Note: Target applications must be permitted in `home/computer-use/config.toml` under `[apps] allowed`. If an app requested by the user is missing, add its executable name, e.g., `"app.exe"`, to `home/computer-use/config.toml` before interacting with it).*

2. **Launch an application if not already running:**
   ```js
   await sky.launch_app({ app: "calc.exe" });
   ```

3. **Capture window state (Screenshot + UI Automation Accessibility Tree):**
   ```js
   const state = await sky.get_window_state({
     window: targetWindow,
     include_screenshot: true,
     include_text: true
   });
   nodeRepl.write(JSON.stringify(state.accessibility, null, 2));
   ```

4. **Interact with elements (via `element_index` or window-relative `x, y` coordinates):**
   ```js
   // Click by accessibility element index (preferred & reliable)
   await sky.click({ window: targetWindow, element_index: 5 });

   // Click by window-relative coordinates
   await sky.click({ window: targetWindow, x: 140, y: 220, click_count: 1 });

   // Set input element text value directly
   await sky.set_value({ window: targetWindow, element_index: 3, value: "TEXT" });

   // Type text into current keyboard focus
   await sky.type_text({ window: targetWindow, text: "text" });

   // Send keyboard keys or hotkeys (e.g., Return, Tab, Control_L+a, Alt+F4)
   await sky.press_key({ window: targetWindow, key: "Return" });

   // Scroll within a window
   await sky.scroll({ window: targetWindow, x: 200, y: 300, scrollX: 0, scrollY: 400 });
   ```

5. **Bring window to foreground / focus:**
   ```js
   await sky.activate_window({ window: targetWindow });
   ```

## Best Practices
- **Prefer Accessibility (`element_index`):** Use UI Automation indices before falling back to `(x, y)` coordinates to prevent failures caused by resolution differences, DPI scaling, or moved windows.
- **Refresh State After Actions:** UI trees change after clicks or inputs. Refresh state using `get_window_state` before deciding the next step.
