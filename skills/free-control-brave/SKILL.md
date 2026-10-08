---
name: free-control-brave
description: Control, automate, and inspect Brave Browser sessions, tabs, and web apps via the local bridge.
---

# Brave Browser Automation (`free-control-brave`)

Execute persistent JavaScript via the `js` MCP tool to automate Brave Browser tabs, interact with web pages, and inspect active user sessions.

## 1. Initialization, Target Brave & Tab Group Session

Always target Brave Browser and assign a descriptive session name. `b.nameSession(...)` creates a dedicated Brave Tab Group labeled with your task title to keep agent tabs isolated from personal tabs.

```js
const { setupBrowserRuntime } = await import("file:///C:/Users/User/.free-computer-user/runtime/browser/browser-client.mjs");
const agent = await setupBrowserRuntime({ environment: "codex-app" });

const browsers = await agent.browsers.list();
const brave = browsers.find(b => b.family === "brave" || b.name.toLowerCase().includes("brave"));
if (!brave) {
  throw new Error(`Brave Browser is not running with the extension connected. Connected browsers: ${browsers.map(b => b.name).join(", ") || "none"}`);
}
const b = await agent.browsers.get(brave.id);

// Group tabs into a named Brave Tab Group
await b.nameSession("Descriptive Task Title");
```

## 2. Managing Tabs

### Create a New Tab (Grouped)
```js
const tab = await b.tabs.new();
await tab.goto("https://search.brave.com");
```

### Inspect or Claim Existing User Tabs
```js
// List open user tabs
const userTabs = await b.user.openTabs();
nodeRepl.write(JSON.stringify(userTabs.map(t => ({ id: t.id, title: t.title, url: t.url })), null, 2));

// Claim an existing user tab into the automation session
await b.user.claimTab(userTabs[0]);
const tab = await b.tabs.get(userTabs[0].id);
```

## 3. Web Navigation & Playwright Selectors

```js
// Navigate
await tab.goto("https://example.com");
await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 30000 });

// Fill input using locator
const searchBox = tab.playwright.locator("input[type='search'], input[name='q']").first();
await searchBox.fill("search query", { timeoutMs: 15000 });
await searchBox.press("Enter");

// Click buttons or links
const submitBtn = tab.playwright.locator("button#submit").first();
await submitBtn.click({ timeoutMs: 10000 });
```

## 4. Inspection, Screenshots & Keep Tab Group Open

```js
// Page metadata
const url = await tab.url();
const title = await tab.title();

// Capture visual screenshot
const pngBytes = await tab.screenshot();

// Keep the tab and tab group open when the turn finishes
await tab.markDeliverable();
```
