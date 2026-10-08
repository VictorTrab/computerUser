---
name: free-control-chrome
description: Automate, inspect, and interact with Google Chrome, Brave, and Microsoft Edge tabs via the local Native Messaging Bridge.
---

# Web Browser Automation (`free-control-chrome`)

Use the `mcp__computer_user__js` tool (or `js` depending on the harness) to automate browser tabs in Google Chrome, Brave, or Edge through the local extension bridge.

## 1. Initialization (Once per session)

```js
var browser = (globalThis.browser ??= (await import("browser")).browser);
```

## 2. Core Workflow & API (`browser`)

1. **List all open browser tabs:**
   ```js
   var tabs = await browser.tabs();
   nodeRepl.write(JSON.stringify(tabs.map(t => ({ id: t.id, title: t.title, url: t.url }))));
   ```

2. **Select or attach to a specific tab:**
   ```js
   var tab = await browser.get_tab({ tabId: tabs[0].id });
   ```

3. **Navigate to a URL (Supports both web URLs and local `file://`):**
   ```js
   await tab.navigate({ url: "https://example.com" });
   // Or local files:
   await tab.navigate({ url: "file:///C:/projects/docs/index.html" });
   ```

4. **Inspect page content (Accessibility Snapshot):**
   ```js
   // Fast, lightweight semantic snapshot without heavy screenshots
   var snapshot = await tab.accessibility.snapshot();
   nodeRepl.write(JSON.stringify(snapshot, null, 2));
   ```

5. **Interact via Playwright Selectors (CSS / XPath / Text):**
   ```js
   // Click an element using selector
   await tab.playwright.click("button#submit");

   // Type into input field
   await tab.playwright.fill("input[name='search']", "Search query");

   // Press keyboard keys
   await tab.playwright.press("Enter");
   ```

6. **Capture page screenshot (When visual validation is required):**
   ```js
   var screenshot = await tab.screenshot();
   nodeRepl.write(JSON.stringify(screenshot));
   ```

7. **Execute custom JavaScript in page context:**
   ```js
   var pageTitle = await tab.evaluate("document.title");
   nodeRepl.write(String(pageTitle));
   ```

## Best Practices
- **Semantic Inspection First:** Always inspect via `tab.accessibility.snapshot()` or Playwright selectors before attempting full-page image captures.
- **Support for Local Development:** Schemes like `file://` and `http://localhost:*` are supported for inspecting local HTML mockups, documentation, or dev servers.
