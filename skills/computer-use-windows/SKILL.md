---
name: computer-use-windows
description: Automatiza aplicaciones de escritorio en Windows (PySide6, ejecutables nativos, diálogos) usando el motor @oai/sky sobre el servidor MCP node_repl.
---

# Computer Use para Escritorio Windows (@oai/sky)

Usa la herramienta `mcp__computer_user__js` (o `js` según el arnés) para ejecutar código JavaScript persistente que controla ventanas de Windows mediante `@oai/sky`.

## 1. Inicialización (una vez por sesión)

```js
if (!globalThis.sky) {
  const { sky } = await import("@oai/sky");
  globalThis.sky = sky;
}
```

## 2. Flujo de Trabajo y API Principal (`sky`)

1. **Listar aplicaciones y ventanas abiertas:**
   ```js
   const apps = await sky.list_apps();
   const windows = await sky.list_windows();
   nodeRepl.write(JSON.stringify(windows, null, 2));
   ```
   *(Nota: La aplicación objetivo debe estar en `home/computer-use/config.toml` dentro de `[apps] allowed`).*

2. **Lanzar una aplicación si no está abierta:**
   ```js
   await sky.launch_app({ app: "python.exe" });
   ```

3. **Capturar estado de una ventana (Screenshot + Árbol de Accesibilidad con índices):**
   ```js
   const state = await sky.get_window_state({
     window: targetWindow,
     include_screenshot: true,
     include_text: true
   });
   nodeRepl.write(JSON.stringify(state.accessibility, null, 2));
   ```

4. **Interactuar con elementos (por `element_index` o coordenadas `x, y` relativas a la ventana):**
   ```js
   // Clic por índice de accesibilidad (recomendado)
   await sky.click({ window: targetWindow, element_index: 5 });

   // Clic por coordenadas relativas a la ventana
   await sky.click({ window: targetWindow, x: 140, y: 220, click_count: 1 });

   // Reemplazar el valor de un input editable directamente
   await sky.set_value({ window: targetWindow, element_index: 3, value: "TEXTO" });

   // Escribir texto en el foco actual
   await sky.type_text({ window: targetWindow, text: "texto" });

   // Enviar teclas o atajos (ej. Return, Tab, Control_L+a, Alt+F4)
   await sky.press_key({ window: targetWindow, key: "Return" });

   // Scroll en la ventana
   await sky.scroll({ window: targetWindow, x: 300, y: 300, scrollX: 0, scrollY: -240 });
   ```
