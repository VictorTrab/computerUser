"""CLI runner for interacting with the ComputerUser MCP server
via OpenAI-compatible chat completion endpoints."""

import os
import sys
import json
import argparse
import subprocess
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MCP_CONFIG_FILE = os.path.join(BASE_DIR, "mcp_config.json")
SKILLS_DIR = os.path.join(BASE_DIR, "skills")
RULES_DIR = os.path.join(BASE_DIR, "rules")

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
    """Cliente Stdio MCP para comunicarse directamente con node_repl.exe."""

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

        self.proc = subprocess.Popen(
            [command] + args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=0,
            env=env
        )
        self.request_id = 0
        self.tools = []
        self._init_handshake()

    def _send(self, payload):
        line = json.dumps(payload) + "\n"
        self.proc.stdin.write(line)
        self.proc.stdin.flush()

    def _recv(self):
        line = self.proc.stdout.readline()
        if not line:
            err = self.proc.stderr.read()
            raise RuntimeError(f"El servidor MCP cerro la conexion: {err}")
        return json.loads(line.strip())

    def _init_handshake(self):
        # 1. initialize
        self.request_id += 1
        self._send({
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
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

    def call_tool(self, name, arguments):
        self.request_id += 1
        self._send({
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments
            }
        })
        res = self._recv()
        result_data = res.get("result", {})
        content_items = result_data.get("content", [])
        texts = [c.get("text", "") for c in content_items if c.get("type") == "text"]
        is_error = result_data.get("isError", False)
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
    chrome_skill = os.path.join(SKILLS_DIR, "free-control-chrome", "SKILL.md")
    if os.path.exists(chrome_skill):
        with open(chrome_skill, "r", encoding="utf-8") as f:
            prompt_parts.append(f.read())

    return "\n\n".join(prompt_parts)


def run_agent_loop(user_query, base_url, model, api_key, max_steps=15):
    mcp_client = ComputerUserMcpClient()
    tools = mcp_client.get_openai_tools()
    system_prompt = load_system_prompt()

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
        res = client.call_tool("js", {"code": "const os = await import('node:os'); nodeRepl.write('Motor local activo en ' + os.platform());"})
        print("[OK] Prueba de ejecucion JS:", res["output"])
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
