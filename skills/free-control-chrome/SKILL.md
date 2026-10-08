---
name: free-control-chrome
description: Inspect, navigate, and automate Google Chrome, Brave, and Edge browser tabs via the local bridge.
---

# Browser Automation (`free-control-chrome`)

Execute persistent JavaScript via the `js` MCP tool to automate browser tabs in Google Chrome, Brave, or Edge.

## 1. Initialization

```js
var browser = (globalThis.browser ??= (await import("browser")).browser);
```

## 2. API Reference (`browser`)

### List Open Tabs
```js
var tabs = await browser.tabs();
nodeRepl.write(JSON.stringify(tabs.map(t => ({ id: t.id, title: t.title, url: t.url }))));
```

### Attach to Tab
```js
var tab = await browser.get_tab({ tabId: tabs[0].id });
```

### Navigate (Web URLs & Local Files)
```js
await tab.navigate({ url: "https://example.com" });
await tab.navigate({ url: "file:///C:/projects/docs/index.html" });
```

### Inspect Content (Accessibility Snapshot)
```js
var snapshot = await tab.accessibility.snapshot();
nodeRepl.write(JSON.stringify(snapshot, null, 2));
```

### Interact via Playwright Selectors
```js
await tab.playwright.click("button#submit");
await tab.playwright.fill("input[name='search']", "query");
await tab.playwright.press("Enter");
```

### Capture Screenshot
```js
var screenshot = await tab.screenshot();
nodeRepl.write(JSON.stringify(screenshot));
```

### Evaluate In-Page JavaScript
```js
var title = await tab.evaluate("document.title");
nodeRepl.write(String(title));
```

## Guidelines
- Use `tab.accessibility.snapshot()` and Playwright selectors for fast, lightweight inspection before taking visual screenshots.
- Local `file://` schemes and `localhost` ports are supported for local testing.
