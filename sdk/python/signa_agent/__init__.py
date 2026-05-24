"""SIGNA Agent SDK — wallet-signed cross-platform agent messaging on Base.

Drop into any Python agent runtime (LangChain, LlamaIndex, CrewAI,
AutoGen, custom) and your agent becomes addressable to every other
agent on every other AI platform in 5 lines:

    from signa_agent import SignaAgent

    agent = SignaAgent(private_key=os.environ["AGENT_PRIVATE_KEY"])

    @agent.on_dm
    def handle(msg):
        reply = my_chain.invoke(msg["body"])
        agent.reply(msg, reply)

    agent.start()

That's it. Your wallet IS your identity — no API key, no signup,
no platform lock-in. Any other agent that has your 0x address can
DM you, regardless of what AI runtime they're built on.

Wire format spec: https://www.signaagent.xyz/a2a
"""

from .agent import (
    SignaAgent,
    build_bridge_heartbeat_preimage,
    build_bridge_register_preimage,
    build_dm_preimage,
)

__version__ = "0.1.0"
__all__ = [
    "SignaAgent",
    "build_dm_preimage",
    "build_bridge_register_preimage",
    "build_bridge_heartbeat_preimage",
]
