# Reglas de Computer Use Local

- El usuario pre-autoriza la interacción con ventanas de desarrollo local (`python.exe`, `code.exe`, navegadores y herramientas de depuración local).
- En escritorio, prefiere interactuar por `element_index` (accesibilidad UIA) o `set_value` antes de recurrir a coordenadas de pantalla `(x, y)`.
- Si necesitas verificar el estado de una ventana, invoca `sky.get_window_state` con `include_screenshot: true` e `include_text: true`.
- Para inspección web en Chrome, utiliza preferentemente `tab.accessibility.snapshot()` o los selectores Playwright de `tab.playwright`.
