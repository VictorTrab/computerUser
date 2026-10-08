"""CLI runner for interacting with the ComputerUser MCP server
via OpenAI-compatible chat completion endpoints."""

import os
import sys
import json
import uuid
import platform
import argparse
import subprocess
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MCP_CONFIG_FILE = os.path.join(BASE_DIR, "mcp_config.json")
SKILLS_DIR = os.path.join(BASE_DIR, "skills")
RULES_DIR = os.path.join(BASE_DIR, "rules")

# Hook de fin de turno del motor de Computer Use. El servidor MCP expone la
# herramienta `turn_ended`, pero esa señal SOLO avisa a las librerias de confianza:
# `browser-service` la usa para soltar la sesion de navegador y NINGUNA libreria la
# usa para el motor de escritorio. El overlay del cursor y su `--system-cursor-manager`
# solo se retiran con este ejecutable (es el `notify` que Codex escribe en
# `<CODEX_HOME>\config.toml`). Medido: sin el, la sesion queda encendida tras la tarea.
_HELPER_ARCH = "codex-computer-use-arm64.exe" if platform.machine().lower() in ("arm64", "aarch64") else "codex-computer-use.exe"
COMPUTER_USE_HELPER = os.path.join(
    BASE_DIR, "runtime", "bin", "node_modules", "@oai", "sky", "bin", "windows", _HELPER_ARCH
)

PROVIDERS = {
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "default_model": "qwen2.5-coder:latest",
        "env_key": None,
        "default_key": "ollama"
    },
    "lmstudio": {
        "base_url": "http://localhost:1234/v1",
        "default_model": "local-model",
        "env_key": None,
        "default_key": "lm-studio"
    },
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "default_model": "deepseek-chat",
        "env_key": "DEEPSEEK_API_KEY",
        "default_key": None
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o",
        "env_key": "OPENAI_API_KEY",
        "default_key": None
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "default_model": "anthropic/claude-3.5-sonnet",
        "env_key": "OPENROUTER_API_KEY",
        "default_key": None
    }
}


class ComputerUserMcpClient:
    """Cliente Stdio MCP para comunicarse directamente con node_repl.exe.

    En Windows el motor se lanza SIEMPRE en `WinSta0\\Default`. Los terminales de
    Antigravity (y de algunos lanzadores sandbox) corren en un escritorio secundario
    (`WinSta0\\exebox-...`) donde Windows deniega `EnumWindows` y `GetCursorPos`, asi
    que un node_repl heredado de ese escritorio no puede ver ni manejar el escritorio
    real. Ademas el servicio `@oai/sky` pide aprobacion al cliente MCP mediante
    `elicitation/create`: si el cliente no la declara/atiende, el motor aborta con
    "Computer Use app approval UI is unavailable outside trusted node_repl".
    """

    def __init__(self, config_path=MCP_CONFIG_FILE):
        if not os.path.exists(config_path):
            raise FileNotFoundError(f"No se encontro el archivo de configuracion MCP: {config_path}")

        with open(config_path, "r", encoding="utf-8-sig") as f:
            config = json.load(f)

        server_def = config["mcpServers"]["computer-user"]
        command = server_def["command"]
        args = server_def.get("args", [])
        env = os.environ.copy()
        env.update(server_def.get("env", {}))

        self.proc = None
        self._pi_handle = None
        if os.name == "nt":
            try:
                self._start_win32_default_desktop(command, args, env)
            except Exception as exc:
                # Degradar en silencio da fallos confusos: si ESTE proceso ya arranco
                # en un escritorio secundario, el propio `import ctypes` falla (el
                # _ctypes de Python no inicializa ahi) y el motor acaba heredando el
                # escritorio malo, donde EnumWindows/GetCursorPos estan denegados.
                self.proc = None
                print(
                    f"[universal_runner] Aviso: no se pudo lanzar el motor en WinSta0\\Default "
                    f"({exc}); se hereda el escritorio actual.",
                    file=sys.stderr,
                )

        if self.proc is None and self._pi_handle is None:
            self.proc = subprocess.Popen(
                [command] + args,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=0,
                env=env
            )
            self._stdin = self.proc.stdin
            self._stdout = self.proc.stdout
            self._stderr = self.proc.stderr

        self.request_id = 0
        self.tools = []
        # Identidad de turno. `browser-service` exige `_meta["x-codex-turn-metadata"]`
        # y el motor de escritorio la usa para saber a que turno pertenece cada accion;
        # este runner es el CLIENTE, asi que la genera el y la mantiene estable durante
        # el turno (un turno = una ejecucion del bucle del agente).
        self.session_id = f"cu-runner-{uuid.uuid4().hex[:12]}"
        self.turn_seq = 0
        self.turn_id = None
        self._init_handshake()

    # ------------------------------------------------------------------
    # Ciclo de turno
    # ------------------------------------------------------------------
    def begin_turn(self):
        """Abre un turno nuevo: identidad fresca para este turno."""
        self.turn_seq += 1
        self.turn_id = f"turn-{self.turn_seq}"
        return {"session_id": self.session_id, "turn_id": self.turn_id, "thread_source": "user"}

    def turn_meta(self):
        if not self.turn_id:
            return None
        return {
            "x-codex-turn-metadata": json.dumps({
                "session_id": self.session_id,
                "turn_id": self.turn_id,
                "thread_source": "user",
            })
        }

    def end_turn(self):
        """Cierra el turno y libera el motor. Best-effort: nunca tumba el turno.

        1. `turn_ended` (herramienta MCP): es la señal de fin de turno. Con ella
           `browser-service` suelta la sesion de navegador (desengancha las pestañas
           CDP y avisa a la extension).
        2. Hook nativo (`codex-computer-use.exe turn-ended <json>`): es lo UNICO que
           retira el overlay del cursor y el `--system-cursor-manager`. Los
           identificadores tienen que ser los del turno que acaba de correr; con otros,
           el evento con nombre no casa y no libera nada.
        3. Si el servidor no expone `turn_ended`, se cierra con `js_reset` (reinicia el
           kernel de JS y el host de servicios de confianza, que se lleva por delante al
           helper de Computer Use) y se avisa por stderr.
        """
        if not self.turn_id:
            return
        exposed = any(t.get("name") == "turn_ended" for t in self.tools)
        released = []
        if exposed:
            try:
                res = self.call_tool("turn_ended", {
                    "hook_event_name": "Stop",
                    "session_id": self.session_id,
                    "turn_id": self.turn_id,
                })
                if res["is_error"]:
                    print(f"[universal_runner] turn_ended devolvio error: {res['output'][:200]}", file=sys.stderr)
                else:
                    released.append("browser-session")
            except Exception as exc:
                print(f"[universal_runner] turn_ended fallo (se continua): {exc}", file=sys.stderr)
        else:
            try:
                self.call_tool("js_reset", {})
                released.append("js_reset")
                print(
                    "[universal_runner] el servidor MCP no expone `turn_ended`: "
                    "se cierra el turno con `js_reset` (libera el motor, pero pierde los bindings).",
                    file=sys.stderr,
                )
            except Exception as exc:
                print(f"[universal_runner] js_reset fallo (se continua): {exc}", file=sys.stderr)

        if os.path.exists(COMPUTER_USE_HELPER):
            payload = json.dumps({
                "type": "agent-turn-complete",
                "session_id": self.session_id,
                "turn_id": self.turn_id,
            })
            try:
                subprocess.run(
                    [COMPUTER_USE_HELPER, "turn-ended", payload],
                    timeout=15, check=False,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                released.append("computer-use-overlay")
            except Exception as exc:
                print(f"[universal_runner] hook de fin de turno fallo (se continua): {exc}", file=sys.stderr)

        if released:
            print(f"[universal_runner] turno cerrado ({self.session_id}/{self.turn_id}); liberado: {', '.join(released)}")
        self.turn_id = None

    def _start_win32_default_desktop(self, command, args, env):
        """Lanza el motor con lpDesktop = WinSta0\\Default (CreateProcessW).

        `subprocess.Popen` no permite elegir el escritorio: hereda el de la consola
        que lo invoca, y ese es justo el que Windows bloquea en Antigravity. Con
        CreateProcessW y `lpDesktop` el hijo vuelve al escritorio interactivo real.
        Los tres pipes se crean a mano (heredables en el lado del hijo) para poder
        seguir hablando JSON-RPC por stdio.
        """
        import ctypes
        from ctypes import wintypes
        import msvcrt

        k32 = ctypes.windll.kernel32

        class STARTUPINFOW(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD), ("lpReserved", wintypes.LPWSTR),
                ("lpDesktop", wintypes.LPWSTR), ("lpTitle", wintypes.LPWSTR),
                ("dwX", wintypes.DWORD), ("dwY", wintypes.DWORD),
                ("dwXSize", wintypes.DWORD), ("dwYSize", wintypes.DWORD),
                ("dwXCountChars", wintypes.DWORD), ("dwYCountChars", wintypes.DWORD),
                ("dwFillAttribute", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                ("wShowWindow", wintypes.WORD), ("cbReserved2", wintypes.WORD),
                ("lpReserved2", ctypes.POINTER(wintypes.BYTE)),
                ("hStdInput", wintypes.HANDLE), ("hStdOutput", wintypes.HANDLE),
                ("hStdError", wintypes.HANDLE),
            ]

        class PROCESS_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("hProcess", wintypes.HANDLE), ("hThread", wintypes.HANDLE),
                ("dwProcessId", wintypes.DWORD), ("dwThreadId", wintypes.DWORD),
            ]

        class SECURITY_ATTRIBUTES(ctypes.Structure):
            _fields_ = [
                ("nLength", wintypes.DWORD),
                ("lpSecurityDescriptor", wintypes.LPVOID),
                ("bInheritHandle", wintypes.BOOL),
            ]

        items = [f"{k}={v}" for k, v in sorted(env.items())]
        env_buf = ctypes.create_unicode_buffer("\0".join(items) + "\0\0")

        sa = SECURITY_ATTRIBUTES(ctypes.sizeof(SECURITY_ATTRIBUTES), None, True)
        r_in, w_in = wintypes.HANDLE(), wintypes.HANDLE()
        r_out, w_out = wintypes.HANDLE(), wintypes.HANDLE()
        r_err, w_err = wintypes.HANDLE(), wintypes.HANDLE()
        k32.CreatePipe(ctypes.byref(r_in), ctypes.byref(w_in), ctypes.byref(sa), 0)
        k32.CreatePipe(ctypes.byref(r_out), ctypes.byref(w_out), ctypes.byref(sa), 0)
        k32.CreatePipe(ctypes.byref(r_err), ctypes.byref(w_err), ctypes.byref(sa), 0)
        # El hijo solo hereda el extremo de escritura de stdin y los de lectura de
        # stdout/stderr; el resto se queda en el padre (si no, la lectura no cierra).
        k32.SetHandleInformation(w_in, 1, 0)
        k32.SetHandleInformation(r_out, 1, 0)
        k32.SetHandleInformation(r_err, 1, 0)

        si = STARTUPINFOW()
        si.cb = ctypes.sizeof(STARTUPINFOW)
        si.lpDesktop = "WinSta0\\Default"
        si.dwFlags = 0x100  # STARTF_USESTDHANDLES
        si.hStdInput = r_in
        si.hStdOutput = w_out
        si.hStdError = w_err
        pi = PROCESS_INFORMATION()

        cmd_str = f'"{command}" ' + " ".join(args)
        cmd_buf = ctypes.create_unicode_buffer(cmd_str)
        ok = k32.CreateProcessW(
            None, cmd_buf, None, None, True, 0x00000400,  # CREATE_UNICODE_ENVIRONMENT
            ctypes.byref(env_buf), None, ctypes.byref(si), ctypes.byref(pi)
        )
        k32.CloseHandle(r_in)
        k32.CloseHandle(w_out)
        k32.CloseHandle(w_err)
        if not ok:
            raise RuntimeError(f"CreateProcessW failed: {ctypes.GetLastError()}")

        self._pi_handle = pi.hProcess
        k32.CloseHandle(pi.hThread)
        self._stdin = os.fdopen(msvcrt.open_osfhandle(w_in.value, 0), "w", encoding="utf-8", buffering=1)
        self._stdout = os.fdopen(msvcrt.open_osfhandle(r_out.value, os.O_RDONLY), "r", encoding="utf-8")
        self._stderr = os.fdopen(msvcrt.open_osfhandle(r_err.value, os.O_RDONLY), "r", encoding="utf-8")

    def _send(self, payload):
        line = json.dumps(payload) + "\n"
        self._stdin.write(line)
        self._stdin.flush()

    def _recv(self):
        while True:
            line = self._stdout.readline()
            if not line:
                err = self._stderr.read()
                raise RuntimeError(f"El servidor MCP cerro la conexion: {err}")
            data = json.loads(line.strip())
            # El motor pide aprobacion para usar una app ANTES de devolver el
            # resultado de tools/call: es una peticion del servidor, no una
            # respuesta, y hay que contestarla o la llamada se queda colgada.
            if data.get("method") == "elicitation/create":
                self._send({
                    "jsonrpc": "2.0",
                    "id": data["id"],
                    "result": {"action": "accept", "content": {"persist": "session"}}
                })
                continue
            if "id" in data:
                return data

    def _init_handshake(self):
        # 1. initialize
        self.request_id += 1
        self._send({
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"elicitation": {}},
                "clientInfo": {"name": "universal-agent-runner", "version": "1.0.0"}
            }
        })
        self._recv()

        # 2. notifications/initialized
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

        # 3. tools/list
        self.request_id += 1
        self._send({
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": "tools/list",
            "params": {}
        })
        tools_res = self._recv()
        self.tools = tools_res.get("result", {}).get("tools", [])

    def call_tool(self, name, arguments, meta=None):
        self.request_id += 1
        params = {
            "name": name,
            "arguments": arguments
        }
        # Este runner es el CLIENTE: manda siempre la identidad del turno vigente para
        # que el runtime sepa a que turno pertenece cada accion y para que el cierre de
        # turno reconozca el suyo.
        turn_meta = self.turn_meta()
        if turn_meta:
            params["_meta"] = {**turn_meta, **(meta or {})}
        elif meta:
            params["_meta"] = meta
        self._send({
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": "tools/call",
            "params": params
        })
        res = self._recv()
        result_data = res.get("result", {})
        content_items = result_data.get("content", [])
        texts = [c.get("text", "") for c in content_items if c.get("type") == "text"]
        is_error = result_data.get("isError", False)
        if "error" in res:
            is_error = True
            texts.append(json.dumps(res["error"]))
        return {"output": "\n".join(texts), "is_error": is_error, "raw": result_data}

    def get_openai_tools(self):
        """Convierte herramientas MCP al formato estandar de function calling."""
        openai_tools = []
        for t in self.tools:
            if t["name"].startswith("turn_"):
                continue
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t.get("inputSchema", {"type": "object", "properties": {}})
                }
            })
        return openai_tools

    def close(self):
        if self._pi_handle:
            import ctypes
            ctypes.windll.kernel32.TerminateProcess(self._pi_handle, 0)
            ctypes.windll.kernel32.CloseHandle(self._pi_handle)
            self._pi_handle = None
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()


def load_system_prompt():
    prompt_parts = [
        "You have direct control of the Windows desktop and web browser via the local ComputerUser MCP server.",
        "You have access to the `js` tool to execute persistent local automation commands.",
        "\n--- OPERATIONAL GOVERNANCE & EXECUTION POLICY ---"
    ]

    rules_file = os.path.join(RULES_DIR, "AGENTS.md")
    if os.path.exists(rules_file):
        with open(rules_file, "r", encoding="utf-8") as f:
            prompt_parts.append(f.read())

    prompt_parts.append("\n--- DESKTOP AUTOMATION GUIDE ---")
    cu_skill = os.path.join(SKILLS_DIR, "free-computer-user", "SKILL.md")
    if os.path.exists(cu_skill):
        with open(cu_skill, "r", encoding="utf-8") as f:
            prompt_parts.append(f.read())

    prompt_parts.append("\n--- BROWSER AUTOMATION GUIDE ---")
    chrome_skill = os.path.join(SKILLS_DIR, "free-control-browser", "SKILL.md")
    if os.path.exists(chrome_skill):
        with open(chrome_skill, "r", encoding="utf-8") as f:
            prompt_parts.append(f.read())

    return "\n\n".join(prompt_parts)


def run_agent_loop(user_query, base_url, model, api_key, max_steps=15):
    mcp_client = ComputerUserMcpClient()
    tools = mcp_client.get_openai_tools()
    system_prompt = load_system_prompt()

    # Un turno = una ejecucion del bucle. La identidad se abre aqui y se cierra al
    # final (con liberacion del motor) tanto si el agente termina como si se agota el
    # presupuesto de pasos o falla el LLM.
    turn = mcp_client.begin_turn()
    print(f"[Universal Agent] Turno: {turn['session_id']}/{turn['turn_id']}")

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_query}
    ]

    headers = {
        "Content-Type": "application/json"
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    url = f"{base_url.rstrip('/')}/chat/completions"

    print(f"\n[Universal Agent] Conectado a: {base_url} (Modelo: {model})")
    print(f"[Universal Agent] Tarea: {user_query}")
    print(f"[Universal Agent] Herramientas MCP listas: {[t['function']['name'] for t in tools]}")

    for step in range(max_steps):
        payload = {
            "model": model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto"
        }

        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=90)
        except Exception as e:
            print(f"Error de conexion al LLM: {e}")
            break

        if resp.status_code != 200:
            print(f"Error HTTP del LLM ({resp.status_code}): {resp.text}")
            break

        data = resp.json()
        choice = data["choices"][0]
        msg = choice["message"]
        messages.append(msg)

        if msg.get("content"):
            print(f"\n[Agente]: {msg['content']}")

        tool_calls = msg.get("tool_calls")
        if not tool_calls:
            print("\n[Universal Agent] Tarea finalizada.")
            break

        for tc in tool_calls:
            fn = tc["function"]
            fn_name = fn["name"]
            fn_args = json.loads(fn.get("arguments", "{}"))
            call_id = tc["id"]

            print(f"\n[Accion Local -> {fn_name}]:")
            if "code" in fn_args:
                code_snippet = fn_args['code'].strip()
                preview = code_snippet[:250] + ("..." if len(code_snippet) > 250 else "")
                print(f"  Codigo JS:\n{preview}")

            res = mcp_client.call_tool(fn_name, fn_args)
            output = res["output"]
            if res["is_error"]:
                print(f"  [Error]: {output}")
            else:
                out_preview = output[:200] + ("..." if len(output) > 200 else "")
                print(f"  [Resultado]: {out_preview}")

            messages.append({
                "role": "tool",
                "tool_call_id": call_id,
                "content": output if output else ("OK" if not res["is_error"] else "Error")
            })

    # Cierre de turno: SIEMPRE, tambien cuando el bucle sale por error o por presupuesto.
    mcp_client.end_turn()
    mcp_client.close()


def main():
    parser = argparse.ArgumentParser(description="Universal ComputerUser Agent Runner (Soporta Ollama, DeepSeek, OpenAI, etc.)")
    parser.add_argument("query", nargs="*", help="Instruccion o tarea para el agente")
    parser.add_argument("--provider", choices=["ollama", "lmstudio", "deepseek", "openai", "openrouter", "custom"], default="deepseek", help="Proveedor de IA")
    parser.add_argument("--model", help="Nombre del modelo (por defecto segun el proveedor)")
    parser.add_argument("--base-url", help="URL base de la API compatible con OpenAI")
    parser.add_argument("--api-key", help="Clave de API (o variable de entorno)")
    parser.add_argument("--test-mcp", action="store_true", help="Verifica solo la conexion MCP con el motor local")

    args = parser.parse_args()

    if args.test_mcp:
        print("Verificando conexion MCP con ComputerUser...")
        client = ComputerUserMcpClient()
        print("[OK] Herramientas disponibles:", [t["name"] for t in client.tools])
        client.begin_turn()
        res = client.call_tool("js", {"code": "const os = await import('node:os'); nodeRepl.write('Motor local activo en ' + os.platform());"})
        print("[OK] Prueba de ejecucion JS:", res["output"])
        client.end_turn()
        client.close()
        return

    query = " ".join(args.query).strip()
    if not query:
        print("Uso:")
        print("  python adapters/universal_runner.py --test-mcp")
        print("  python adapters/universal_runner.py --provider ollama \"Abre la calculadora y suma 5 + 5\"")
        print("  python adapters/universal_runner.py --provider deepseek \"Lista las ventanas abiertas\"")
        print("  python adapters/universal_runner.py --provider openai --model gpt-4o \"Abre Chrome y busca Python\"")
        return

    # Resolver configuracion del proveedor
    prov_conf = PROVIDERS.get(args.provider, {})
    base_url = args.base_url or prov_conf.get("base_url") or "https://api.deepseek.com"
    model = args.model or prov_conf.get("default_model") or "deepseek-chat"

    api_key = args.api_key
    if not api_key and prov_conf.get("env_key"):
        api_key = os.getenv(prov_conf["env_key"])
    if not api_key and prov_conf.get("default_key"):
        api_key = prov_conf["default_key"]

    if not api_key and args.provider not in ["ollama", "lmstudio"]:
        env_name = prov_conf.get("env_key", "API_KEY")
        api_key = os.getenv("AI_API_KEY") or os.getenv("OPENAI_API_KEY")
        if not api_key:
            api_key = input(f"Introduce tu API Key para {args.provider} (o configura {env_name}): ").strip()
            if not api_key:
                print("Se requiere API Key para continuar.")
                return

    run_agent_loop(query, base_url, model, api_key)


if __name__ == "__main__":
    main()
