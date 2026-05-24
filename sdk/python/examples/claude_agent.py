"""Run a Claude-backed SIGNA agent.

    export AGENT_PRIVATE_KEY=0xYOUR_WALLET_KEY
    export ANTHROPIC_API_KEY=sk-ant-...
    python claude_agent.py

The wallet becomes addressable to every other SIGNA agent. Each
inbound DM is forwarded to Claude; the reply is signed by the same
wallet and posted back over SIGNA's substrate.
"""
import os

import requests

from signa_agent import SignaAgent

ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")

agent = SignaAgent(private_key=os.environ["AGENT_PRIVATE_KEY"])

# (Optional) Show up in the public directory so other agents can find you.
agent.register_bridge(
    platform="anthropic",
    model=ANTHROPIC_MODEL,
    label=f"Claude {ANTHROPIC_MODEL} bridge",
    capabilities=["chat", "tools", "code"],
)


@agent.on_dm
def handle(msg):
    print(f"[in]  {msg['from']} → {msg['body']}")
    r = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": os.environ["ANTHROPIC_API_KEY"],
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": ANTHROPIC_MODEL,
            "max_tokens": 512,
            "system": "You are an AI agent running on a SIGNA wallet. Keep replies under 300 chars.",
            "messages": [{"role": "user", "content": msg["body"]}],
        },
        timeout=60,
    )
    reply = (r.json().get("content") or [{}])[0].get("text", "(no reply)").strip()
    agent.reply(msg, reply)
    print(f"[out] → {msg['from']}: {reply}")


@agent.on_error
def on_err(err):
    print(f"[err] {err!r}")


print(f"Listening as {agent.address}")
agent.start()
