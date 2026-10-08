---
name: control-chrome
description: Controla el navegador Chrome/Edge del usuario (pestañas abiertas, sesiones autenticadas, archivos locales file:// y Playwright) mediante el runtime independiente de browser-client.
---

# Control de Chrome y Edge (browser-client)

Usa la herramienta `mcp__computer_user__js` (o `js` según el arnés) para conectarte a la instancia activa de Google Chrome o Microsoft Edge del usuario conservando su sesión.

## 1. Inicialización (una vez por sesión)

```js
const { setupBrowserRuntime } = await import("C:/Users/User/projects/computerUser/runtime/browser/browser-client.mjs");
const agent = await setupBrowserRuntime();
const chrome = await agent.browsers.get("chrome");
```

## 2. Operaciones sobre Pestañas (`chrome.tabs`)

```js
// Listar pestañas disponibles
const tabs = await chrome.tabs.list();
nodeRepl.write(JSON.stringify(tabs, null, 2));

// Crear una nueva pestaña o abrir URL existente
const tab = await chrome.tabs.new();

// Navegar a URL (soporta https://, http:// y rutas file://)
await tab.navigate("file:///C:/Users/User/Documents/report.html");

// Usar la API integrada de Playwright sobre la pestaña
const title = await tab.playwright.title();
const snapshot = await tab.accessibility.snapshot();
nodeRepl.write(JSON.stringify({ title, snapshot }, null, 2));
```

## 3. Requisitos
- La extensión oficial debe estar habilitada en el navegador.
- Para rutas locales `file://`, activar «Permitir acceso a URLs de archivo» en `chrome://extensions`.
- Ejecutar `setup_chrome_native_host.ps1` una vez para apuntar el NativeMessagingHost al binario de este proyecto.
