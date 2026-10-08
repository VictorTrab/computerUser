# Reglas de Computer User para Agentes de IA

Este documento rige el comportamiento de cualquier agente de IA (Cursor, Cline, OpenCode, DeepSeek Harness, Antigravity, etc.) al utilizar el motor de automatización local `computerUser`.

---

## 1. Reglas de Acceso a Aplicaciones (Allowlist de Seguridad)

- **Política de Ejecutables:** El motor nativo de Windows valida el nombre del proceso contra la lista blanca en `home/computer-use/config.toml`. Cualquier intento de interactuar con un ejecutable fuera de esta lista será bloqueado por política.
- **Gestión Dinámica de Apps:** Si el usuario te pide controlar una aplicación legítima que no está en la lista (por ejemplo: un software interno, una app de diseño, etc.):
  1. Identifica el nombre del proceso ejecutable (ej. `app.exe`).
  2. Añádelo a la sección `[apps] allowed` de `home/computer-use/config.toml`.
  3. Procede con la automatización sin interrumpir innecesariamente al usuario.
- **Límites Estrictos de Seguridad:**
  - **NUNCA** agregues a la lista ni interactúes con herramientas de configuración crítica del sistema: `regedit.exe`, administradores de discos, ventanas de elevación de privilegios de Windows (UAC / `Consent.exe`) ni gestores de contraseñas/banca.

---

## 2. Reglas de Interacción en Escritorio (`@oai/sky`)

- **Prioridad Semántica (UIA):** Prefiere siempre interactuar mediante `element_index` (árbol de accesibilidad nativo de Windows) y `set_value` antes de recurrir a coordenadas de pantalla `(x, y)`. Esto garantiza robustez frente a cambios de resolución, escalado de DPI o movimiento de ventanas.
- **Ciclo de Verificación:** Trata `sky.get_window_state` como una foto instantánea. Siempre que realices una acción que modifique el estado de la interfaz (un clic, enviar texto, atajo de teclado), actualiza el estado con:
  ```js
  const state = await sky.get_window_state({ window: targetWindow, include_screenshot: true, include_text: true });
  ```
- **Lanzamiento y Recuperación:** Si la app objetivo no está visible en `sky.list_windows()`, lánzala con `sky.launch_app({ app: "..." })` o mediante el sistema, espera un breve instante y refresca `sky.list_windows()` antes de continuar.

---

## 3. Reglas de Automatización de Navegador (Chrome / Brave Bridge)

- **Inspección Rápida:** En lugar de hacer capturas pesadas y OCR visual, aprovecha el puente nativo de la extensión:
  - Usa `tab.accessibility.snapshot()` para leer el contenido y estructura de la página.
  - Usa `tab.playwright` para clics, escritura y navegación basada en selectores CSS/XPath.
- **Archivos Locales:** Para abrir archivos HTML, PDFs o recursos locales, el puente admite esquemas `file://`.

---

## 4. Acciones Destructivas y Confirmación con el Usuario

- **Confirmación Requerida:** Solicita confirmación explícita al usuario antes de:
  1. Eliminar archivos, bases de datos o configuraciones permanentes.
  2. Enviar correos electrónicos, mensajes en Slack/Discord o publicaciones en redes sociales que no sean borradores.
  3. Realizar transacciones financieras o autorizaciones de credenciales.
