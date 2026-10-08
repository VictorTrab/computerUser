---
name: free-control-edge
description: Control, automate, and inspect Microsoft Edge browser sessions, tabs, and web apps via the local bridge.
---

# Microsoft Edge Automation (`free-control-edge`)

Execute persistent JavaScript via the `js` MCP tool to automate Microsoft Edge tabs, interact with web pages, and inspect active user sessions.

## 1. Initialization, Target Edge & Tab Group Session

Always target Microsoft Edge and assign a descriptive session name. `b.nameSession(...)` creates a dedicated Edge Tab Group labeled with your task title to keep agent tabs isolated from personal tabs.

```js
const { setupBrowserRuntime } = await import("file:///C:/Users/User/.free-computer-user/runtime/browser/browser-client.mjs");
const agent = await setupBrowserRuntime({ environment: "codex-app" });

const browsers = await agent.browsers.list();
const edge = browsers.find(b => b.family === "edge" || b.name.toLowerCase().includes("edge"));
if (!edge) {
  throw new Error(`Microsoft Edge is not running with the extension connected. Connected browsers: ${browsers.map(b => b.name).join(", ") || "none"}`);
}
const b = await agent.browsers.get(edge.id);

// Group tabs into a named Edge Tab Group
await b.nameSession("Descriptive Task Title");
```

## 2. Managing Tabs

### Create a New Tab (Grouped)
```js
const tab = await b.tabs.new();
await tab.goto("https://www.bing.com");
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

## 3. Smart Web Navigation & Locators

Avoid redundant reloads: check current URL before navigating.

```js
const targetUrl = "https://example.com";
if ((await tab.url()) !== targetUrl) {
  await tab.goto(targetUrl);
  await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 30000 });
}

// Locate and interact with elements
const searchBox = tab.playwright.locator("input[type='search'], input[name='q']").first();
await searchBox.fill("search query", { timeoutMs: 15000 });
await searchBox.press("Enter");

const submitBtn = tab.playwright.locator("button#submit").first();
await submitBtn.click({ timeoutMs: 10000 });
```

## 4. Economic State Inspection

Prioritize reading the DOM structure or accessibility tree before taking screenshots. Use screenshots only when visual appearance, rendering, or proof is needed.

```js
// 1. Economic text/element inspection (fast, low overhead)
const snapshot = await tab.domSnapshot();

// 2. Visual screenshot (only when visual verification is necessary)
const pngBytes = await tab.screenshot();
```

## 5. Tab Lifecycle Management

Manage tabs responsibly:
- **Deliverables:** Mark final user-requested results so the tab and group stay open.
- **Handoff:** Transfer to user when manual intervention (2FA, CAPTCHAs, payments) is required.
- **Ephemeral cleanup:** Close throwaway search tabs to avoid polluting the browser.
- **User tabs:** Never close tabs claimed via `b.user.claimTab(...)`.

```js
// Keep the tab and tab group open as final deliverable
await tab.markDeliverable();

// Transfer manual control to user (e.g. for login 2FA or CAPTCHA)
await tab.markHandoff();
// Or request immediate browser focus for user intervention:
await tab.requestManualHandoff();

// Close temporary / discardable tab when done
await tab.close();
```

## 6. Visual Evidence Reporting

When capturing visual confirmation for the user, save or display the image inline in your response (`![captura](ruta_o_uri)`) so the user can verify the outcome without opening disk paths manually.
