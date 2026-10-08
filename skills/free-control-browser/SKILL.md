---
name: free-control-browser
description: Control, automate and inspect the user's real Chrome, Brave or Edge session (tabs, navigation, forms, screenshots) through the local ComputerUser bridge. Single skill for the three browsers, Chrome by default.
---

# Browser Automation (`free-control-browser`)

Drive the user's **own** browser session (their profile, cookies and logins) through the local ComputerUser bridge. Works with **Google Chrome (default)**, **Brave** and **Microsoft Edge** — same API for all three.

Execution happens through persistent JavaScript in the `js` MCP tool.

## 0. Choosing the browser

| Situation | What to do |
| --- | --- |
| No browser mentioned by the user | Use **Chrome** (`getBrowser()`). |
| User says "en Brave", "usa Edge", "abre Chrome" | Pass that family: `getBrowser("brave")` / `getBrowser("edge")` / `getBrowser("chrome")`. |
| The requested browser is not connected | `listBrowsers()` shows what is connected. Tell the user to open that browser and, if needed, reload the ComputerUser extension there. Do **not** silently switch browsers. |

Only one browser instance is bridged at a time (the extension that owns the native host connection).

## 1. Connect and start a tab group session

```js
const { getBrowser, listBrowsers } = await import("browser");

// Optional: see what is connected
nodeRepl.write(JSON.stringify(await listBrowsers(), null, 2));

// Chrome by default; use "brave" / "edge" when the user asks for it
const b = await getBrowser("chrome");

// Name the session: creates a dedicated tab group so agent tabs stay isolated
await b.nameSession("Descriptive task title");
```

## 2. Tabs

```js
// New tab (stays in the session group)
const tab = await b.tabs.new();
await tab.goto("https://www.google.com");

// List agent tabs / the selected one
const tabs = await b.tabs.list();
const current = await b.tabs.selected();

// Work with the user's own tabs
const userTabs = await b.user.openTabs();
nodeRepl.write(JSON.stringify(userTabs.map(t => ({ id: t.id, title: t.title, url: t.url })), null, 2));

// Take control of one of the user's tabs (never close it afterwards)
const claimed = await b.user.claimTab(userTabs[0]);
```

## 3. Navigation and interaction

`tab.url()` and `tab.title()` are **async**. Avoid redundant navigations.

```js
const target = "https://example.com";
if ((await tab.url()) !== target) {
  await tab.goto(target);
  await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 30000 });
}

const search = tab.playwright.locator("input[name='q']").first();
await search.fill("computer user", { timeoutMs: 15000 });
await search.press("Enter", { timeoutMs: 15000 });

await tab.playwright.locator("button#submit").first().click({ timeoutMs: 10000 });

// Role/text based locators are more robust than CSS when the DOM is noisy
const link = tab.playwright.getByRole("link", { name: "Documentation" }).first();
await link.click({ timeoutMs: 10000 });
```

Useful `tab.playwright` helpers: `evaluate(fn, arg)`, `waitForURL(url, opts)`, `waitForTimeout(ms)`, `expectNavigation(action, opts)`, `getByText/getByLabel/getByTestId`, `frameLocator(sel)`.

Accessibility based interaction (no selectors needed): `tab.ax.get()`, `tab.ax.write()`, `tab.ax.click(elementIndex)`, `tab.ax.typeText(index, text)`, `tab.ax.pressKey(index, key)`, `tab.ax.scroll(target, direction)`.

## 4. Reading state

```js
// Preferred: DOM snapshot / locators (cheap)
const snapshot = await tab.playwright.domSnapshot();

// Text of a region
const text = await tab.playwright.locator("main").first().innerText({ timeoutMs: 10000 });

// Page JS (read-only scope)
const count = await tab.playwright.evaluate(() => document.querySelectorAll("a").length);

// Screenshots only when visual verification is actually needed
const png = await tab.screenshot({});
await nodeRepl.emitImage(png);
```

Exports: `tab.content.export()` (page → file), `tab.content.exportGsuite("pdf"|"docx"|"xlsx"|"csv"|"pptx"|"md")`, `tab.content.exportYouTubeTranscript()`.

## 5. Tab lifecycle (always finish it)

- **Deliverable** (the result the user asked for): `await tab.markDeliverable();` — keeps the tab and group open.
- **Handoff** (2FA, CAPTCHA, payment, human decision): `await tab.markHandoff();` and/or `await tab.requestManualHandoff();`
- **Ephemeral** (throwaway searches): `await tab.close();` before finishing.
- **Tabs claimed from the user**: never close them; just release them.

## 6. When something fails

| Error | Meaning / fix |
| --- | --- |
| `No browser is connected to the ComputerUser bridge.` | The extension is not running in any browser. Ask the user to open Chrome/Brave/Edge with the ComputerUser extension enabled (and reload it if it was just installed). |
| `Browser "edge" is not connected ... Connected: chrome (...) ` | The requested browser is not the bridged one. Tell the user which browser is connected instead of switching silently. |
| `Module not found: browser` | The runtime installation is incomplete: re-run `free-computer-user update` (it restores the `browser` shim inside `runtime\bin\node_modules`). |
| Anything mentioning `codex`/auth tokens | The runtime is running without `BROWSER_USE_DISABLE_AMBIENT_NETWORK=1`. Re-run the installer so `mcp_config.json` carries the offline defaults. |
| Element not found / timeout | Re-read the DOM (`domSnapshot()`, `locator(...).count()`) before retrying; avoid blind retry loops. |

Visual evidence for the user: embed it inline in the response (`![captura](ruta)`) instead of printing raw paths.
