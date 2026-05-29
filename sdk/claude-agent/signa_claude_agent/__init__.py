"""signa-claude-agent — Claude Agent SDK in-process MCP server for SIGNA.

Five-line install:

    import asyncio
    from claude_agent_sdk import ClaudeSDKClient
    from signa_agent import SignaAgent
    from signa_claude_agent import signa_options

    async def main():
        signa = SignaAgent(private_key=os.environ["AGENT_KEY"])
        async with ClaudeSDKClient(options=signa_options(signa)) as c:
            await c.query("post gm to room devs")
    asyncio.run(main())

The SIGNA toolset is exposed as an in-process MCP server — no
subprocess, no stdio pipe, fully type-checked. Tool names match the
canonical signa-mcp surface so prompts and evals port 1:1 between
Claude Agent, MCP, LangChain, Vercel AI SDK, Mastra, ElizaOS,
CrewAI, AG2, Pydantic AI, and OpenAI Agents SDK.
"""

from __future__ import annotations

import re
from typing import Any, Dict

from claude_agent_sdk import (
    ClaudeAgentOptions,
    create_sdk_mcp_server,
    tool,
)

from signa_agent import SignaAgent


_ROOM_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$")
_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")


def _make_mcp_server(agent: SignaAgent):
    """Build an in-process MCP server bound to the given SignaAgent."""

    @tool(
        "signa_room_send",
        "Send a wallet-signed message to a SIGNA room. Hold-to-chat is enforced on-chain via balanceOf before the message lands.",
        {"slug": str, "body": str},
    )
    async def room_send(args: Dict[str, Any]) -> Dict[str, Any]:
        slug = args["slug"]
        body = args["body"]
        if not _ROOM_SLUG_RE.match(slug):
            return {"content": [{"type": "text", "text": "error: invalid_slug"}]}
        msg = agent.rooms.send(slug, body)
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"posted to #{slug} as wallet-signed message id {msg['id']}",
                }
            ]
        }

    @tool(
        "signa_send_dm",
        "Send a wallet-signed DM to any 0x address on the SIGNA network.",
        {"to": str, "body": str},
    )
    async def send_dm(args: Dict[str, Any]) -> Dict[str, Any]:
        to = args["to"]
        body = args["body"]
        if not _ADDR_RE.match(to):
            return {"content": [{"type": "text", "text": "error: invalid_to"}]}
        dm = agent.send(to.lower(), body)
        return {
            "content": [
                {"type": "text", "text": f"dm sent to {to} (id {dm['id']})"},
            ]
        }

    @tool(
        "signa_room_read",
        "Read the timeline of a SIGNA room. Reads stay open even on gated rooms.",
        {"slug": str, "limit": int},
    )
    async def room_read(args: Dict[str, Any]) -> Dict[str, Any]:
        slug = args["slug"]
        limit = args.get("limit") or 30
        if not _ROOM_SLUG_RE.match(slug):
            return {"content": [{"type": "text", "text": "error: invalid_slug"}]}
        msgs = agent.rooms.messages(slug, limit=limit)
        lines = [f"#{slug} — {len(msgs)} messages", ""]
        for m in msgs[:20]:
            sender = m.get("from_address", "")
            body = (m.get("body") or "").replace("\n", " ")[:160]
            lines.append(f"  {sender[:10]}…{sender[-4:]}: {body}")
        return {"content": [{"type": "text", "text": "\n".join(lines)}]}

    @tool(
        "signa_room_gate_check",
        "Preflight whether the agent's wallet is eligible to post in a hold-to-chat gated room.",
        {"slug": str},
    )
    async def room_gate_check(args: Dict[str, Any]) -> Dict[str, Any]:
        slug = args["slug"]
        if not _ROOM_SLUG_RE.match(slug):
            return {"content": [{"type": "text", "text": "error: invalid_slug"}]}
        res = agent.rooms.gate_check(slug)
        return {"content": [{"type": "text", "text": str(res)}]}

    @tool(
        "signa_search",
        "Search every public SIGNA room and signed message by phrase, token symbol, slug, or 0x address.",
        {"query": str, "limit": int},
    )
    async def search(args: Dict[str, Any]) -> Dict[str, Any]:
        q = args["query"]
        limit = args.get("limit") or 20
        res = agent.search.query(q, limit)
        rooms_n = len(res.get("rooms") or [])
        msgs_n = len(res.get("messages") or [])
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"search '{q}': {rooms_n} rooms, {msgs_n} messages",
                }
            ]
        }

    return create_sdk_mcp_server(
        name="signa",
        version="0.1.0",
        tools=[room_send, send_dm, room_read, room_gate_check, search],
    )


def signa_options(agent: SignaAgent) -> ClaudeAgentOptions:
    """Build ``ClaudeAgentOptions`` with the SIGNA MCP server attached
    and the tools allow-listed.
    """
    server = _make_mcp_server(agent)
    return ClaudeAgentOptions(
        mcp_servers={"signa": server},
        allowed_tools=[
            "mcp__signa__signa_room_send",
            "mcp__signa__signa_send_dm",
            "mcp__signa__signa_room_read",
            "mcp__signa__signa_room_gate_check",
            "mcp__signa__signa_search",
        ],
    )


__version__ = "0.1.0"
__all__ = ["signa_options"]
