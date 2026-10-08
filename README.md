# ComputerUser (Free Computer User)

<p align="center">
  <img src="assets/intro.gif" alt="ComputerUser Intro Animation" width="750" />
</p>

<p align="center">
  <strong>Motor autónomo independiente de Computer Use (Windows UI Automation) y Control de Navegador (Chrome & Brave) para cualquier agente de IA.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
  <img src="https://img.shields.io/badge/Protocol-MCP%20Stdio%20(JSON--RPC)-8B5CF6?style=for-the-badge" alt="MCP Protocol" />
  <img src="https://img.shields.io/badge/Browser-Chrome%20%7C%20Brave%20%7C%20Edge-FF4500?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Browsers" />
  <img src="https://img.shields.io/badge/Harness-DeepSeek%20%7C%20Antigravity%20%7C%20Cursor-10B981?style=for-the-badge" alt="Harnesses" />
  <img src="https://img.shields.io/badge/Extension-Manifest%20V3-blue?style=for-the-badge" alt="Manifest V3" />
</p>

---

## Instalación

En una terminal de PowerShell, ejecuta:

```powershell
irm https://raw.githubusercontent.com/VictorTrab/computerUser/main/scripts/install.ps1 | iex
```

El instalador descarga el paquete optimizado desde GitHub Releases, registra el Native Messaging Host en los navegadores, despliega las skills en `~/.agents/skills` y configura el servidor MCP en los arneses detectados.

---

## Comandos CLI (`free-computer-user`)

Disponible en PowerShell o CMD una vez instalado:

* **Diagnóstico de salud:**
  ```powershell
  free-computer-user doctor
  ```
* **Actualizar a la última versión:**
  ```powershell
  free-computer-user update
  ```
* **Desinstalar limpiamente:**
  ```powershell
  free-computer-user uninstall
  ```

---

## Cargar la Extensión en Chrome o Brave

1. Abre `chrome://extensions` o `brave://extensions`.
2. Activa el modo de desarrollador.
3. Haz clic en "Cargar descomprimida" y selecciona:
   ```text
   C:\Users\<TuUsuario>\.free-computer-user\extension
   ```
4. En los detalles de la extensión, activa "Permitir acceso a URLs de archivo".

---

## Ejemplos de Uso

Solicita las tareas directamente en lenguaje natural desde el chat de tu agente:

### Escritorio Windows (`free-computer-user`)
- "Lista las ventanas abiertas y dime el título de la activa."
- "Abre la calculadora de Windows y suma 45 + 12."
- "Captura el estado de la ventana activa y haz clic en Iniciar Sesión."

### Navegador (`free-control-chrome`)
- "Revisa las pestañas abiertas en Chrome."
- "Navega a file:///C:/proyectos/docs/index.html y resume el contenido."
- "Haz clic en el botón de búsqueda e introduce la consulta."

---

## Estructura del Sistema

```text
free-computer-user/
├── bin/
│   ├── free-computer-user.cmd     # Wrapper para consola CMD
│   └── free-computer-user.ps1     # CLI de administración en PowerShell
├── runtime/
│   ├── bin/                       # Servidor MCP Stdio (node_repl.exe) y runtime Node
│   ├── browser/                   # Scripts de automatización web
│   └── extension-host/            # Host nativo de mensajería para navegadores
├── extension/                     # Extensión Manifest V3 para Chrome, Brave y Edge
├── home/
│   └── computer-use/config.toml   # Allowlist de aplicaciones autorizadas
├── skills/
│   ├── free-computer-user/        # Guía técnica para automatización de escritorio
│   └── free-control-chrome/       # Guía técnica para control de navegador
├── rules/
│   └── AGENTS.md                  # Políticas de ejecución y gobernanza operativa
├── scripts/
│   ├── install.ps1                # Instalador universal
│   ├── update.ps1                 # Actualizador
│   ├── uninstall.ps1              # Desinstalador
│   ├── doctor.ps1                 # Verificador de diagnóstico
│   └── package.ps1                # Empaquetador CI/CD
└── adapters/
    └── universal_runner.py        # Runner CLI para pruebas directas
```

---

## Seguridad y Aislamiento

- **Control de procesos:** La lista blanca en `home/computer-use/config.toml` restringe los ejecutables sobre los cuales el motor puede interactuar.
- **Sin telemetría externa:** El Native Messaging Host corre localmente vía Stdio (`127.0.0.1`). No realiza llamadas a servidores de terceros.
- **Sesión real:** Interactúa con tus navegadores y ventanas locales existentes sin necesidad de exponer puertos remotos de depuración.
