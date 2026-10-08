"""
DeepSeek Harness Adapter para ComputerUser MCP Server
Permite que un agente DeepSeek (o cualquier modelo con OpenAI-compatible tool calling)
controle el escritorio Windows (@oai/sky) y Chrome (browser-client) mediante MCP.
"""

import os
import sys
import json
import subprocess
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MCP_CONFIG_FILE = os.path.join(BASE_DIR, "mcp_config.json")
SKILLS_DIR = os.path.join(BASE_DIR, "skills")
RULES_DIR = os.path.join(BASE_DIR, "rules")


class ComputerUserMcpClient:
    """Cliente Stdio MCP para comunicarse con node_repl.exe."""

    def __init__(self, config_path=MCP_CONFIG_FILE):
        with open(config_path, "r", encoding="utf-8") as f:
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
            raise RuntimeError(f"El servidor MCP cerró la conexión: {err}")
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
                "clientInfo": {"name": "deepseek-harness", "version": "1.0.0"}
            }
        })
        init_res = self._recv()

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
        """Convierte las herramientas MCP al formato OpenAI/DeepSeek function calling."""
        openai_tools = []
        for t in self.tools:
            # Ocultamos herramientas internas si las hay
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
        "Eres un agente con control directo del escritorio Windows y del navegador Chrome.",
        "Tienes disponible la herramienta `js` que ejecuta código JavaScript persistente en el sistema del usuario.",
        "\n--- REGLAS DE AGENTE ---"
    ]

    rules_file = os.path.join(RULES_DIR, "AGENTS.md")
    if os.path.exists(rules_file):
        with open(rules_file, "r", encoding="utf-8") as f:
            prompt_parts.append(f.read())

    prompt_parts.append("\n--- GUÍA COMPUTER USE (ESCRITORIO) ---")
    cu_skill = os.path.join(SKILLS_DIR, "computer-use-windows", "SKILL.md")
    if os.path.exists(cu_skill):
        with open(cu_skill, "r", encoding="utf-8") as f:
            prompt_parts.append(f.read())

    prompt_parts.append("\n--- GUÍA CONTROL CHROME (NAVEGADOR) ---")
    chrome_skill = os.path.join(SKILLS_DIR, "control-chrome", "SKILL.md")
    if os.path.exists(chrome_skill):
        with open(chrome_skill, "r", encoding="utf-8") as f:
            prompt_parts.append(f.read())

    return "\n\n".join(prompt_parts)


def run_agent_loop(user_query, api_key=None, base_url="https://api.deepseek.com", model="deepseek-chat"):
    api_key = api_key or os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        print("Aviso: No se detectó DEEPSEEK_API_KEY en variables de entorno.")
        api_key = input("Introduce tu DEEPSEEK_API_KEY (o pulsa Enter para salir): ").strip()
        if not api_key:
            return

    mcp_client = ComputerUserMcpClient()
    tools = mcp_client.get_openai_tools()
    system_prompt = load_system_prompt()

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_query}
    ]

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    url = f"{base_url.rstrip('/')}/chat/completions"

    print(f"\n[DeepSeek Agent] Iniciando tarea: {user_query}")
    print(f"[DeepSeek Agent] Herramientas MCP activas: {[t['function']['name'] for t in tools]}")

    max_steps = 15
    for step in range(max_steps):
        payload = {
            "model": model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto"
        }

        resp = requests.post(url, headers=headers, json=payload, timeout=60)
        if resp.status_code != 200:
            print(f"Error de DeepSeek API ({resp.status_code}): {resp.text}")
            break

        data = resp.json()
        choice = data["choices"][0]
        msg = choice["message"]
        messages.append(msg)

        if msg.get("content"):
            print(f"\n[DeepSeek]: {msg['content']}")

        tool_calls = msg.get("tool_calls")
        if not tool_calls:
            print("\n[DeepSeek Agent] Tarea completada.")
            break

        for tc in tool_calls:
            fn = tc["function"]
            fn_name = fn["name"]
            fn_args = json.loads(fn.get("arguments", "{}"))
            call_id = tc["id"]

            print(f"\n[Tool Call] {fn_name}:")
            if "code" in fn_args:
                print(f"--- Código JS ---\n{fn_args['code'].strip()}\n-----------------")

            res = mcp_client.call_tool(fn_name, fn_args)
            output = res["output"]
            if res["is_error"]:
                print(f"[Tool Error]: {output}")
            else:
                print(f"[Tool Output]: {output[:300]}..." if len(output) > 300 else f"[Tool Output]: {output}")

            messages.append({
                "role": "tool",
                "tool_call_id": call_id,
                "content": output if output else ("OK" if not res["is_error"] else "Error")
            })

    mcp_client.close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--test-mcp":
        print("Probando conexión MCP con node_repl...")
        client = ComputerUserMcpClient()
        print("Herramientas encontradas:", [t["name"] for t in client.tools])
        res = client.call_tool("js", {"code": "const os = await import('node:os'); nodeRepl.write('MCP test exitoso en ' + os.platform());"})
        print("Resultado:", res["output"])
        client.close()
        print("Prueba finalizada.")
    elif len(sys.argv) > 1:
        query = " ".join(sys.argv[1:])
        run_agent_loop(query)
    else:
        print("Uso:")
        print("  python deepseek_harness.py --test-mcp")
        print("  python deepseek_harness.py \"Lista las ventanas abiertas en mi equipo\"")
