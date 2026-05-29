"""signa-pydantic-ai — Pydantic AI tools for SIGNA.

Five-line install:

    from pydantic_ai import Agent
    from signa_agent import SignaAgent
    from signa_pydantic_ai import SignaDeps, attach_signa

    agent = Agent("openai:gpt-4o", deps_type=SignaDeps)
    attach_signa(agent)
    agent.run_sync("post gm to room devs",
                   deps=SignaDeps(signa=SignaAgent(private_key=KEY)))

Tool names match the canonical signa-mcp surface.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional

from pydantic_ai import Agent, RunContext

from signa_agent import SignaAgent


_ROOM_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$")
_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")


@dataclass
class SignaDeps:
    """Deps object that holds the SignaAgent. Pass to ``agent.run(...)``
    via the ``deps=`` keyword.
    """

    signa: SignaAgent


def attach_signa(agent: Agent[SignaDeps, Any]) -> None:
    """Attach every SIGNA tool to a Pydantic AI ``Agent``. The agent
    must be declared with ``deps_type=SignaDeps`` so the tools can pull
    the underlying ``SignaAgent`` from ``ctx.deps``.
    """

    @agent.tool
    def signa_room_send(
        ctx: RunContext[SignaDeps],
        slug: str,
        body: str,
    ) -> dict[str, Any]:
        """Send a wallet-signed message to a SIGNA room. Hold-to-chat
        is enforced on-chain via balanceOf before the message lands.
        """
        if not _ROOM_SLUG_RE.match(slug):
            return {"ok": False, "error": "invalid_slug"}
        msg = ctx.deps.signa.rooms.send(slug, body)
        return {"ok": True, "message_id": msg["id"], "ts": msg["ts"]}

    @agent.tool
    def signa_send_dm(
        ctx: RunContext[SignaDeps],
        to: str,
        body: str,
    ) -> dict[str, Any]:
        """Send a wallet-signed DM to any 0x address on the SIGNA network."""
        if not _ADDR_RE.match(to):
            return {"ok": False, "error": "invalid_to"}
        dm = ctx.deps.signa.send(to.lower(), body)
        return {"ok": True, "dm_id": dm["id"]}

    @agent.tool
    def signa_room_read(
        ctx: RunContext[SignaDeps],
        slug: str,
        limit: Optional[int] = 30,
    ) -> dict[str, Any]:
        """Read the timeline of a SIGNA room. Reads always open."""
        if not _ROOM_SLUG_RE.match(slug):
            return {"ok": False, "error": "invalid_slug"}
        msgs = ctx.deps.signa.rooms.messages(slug, limit=limit or 30)
        return {"ok": True, "count": len(msgs), "messages": msgs}

    @agent.tool
    def signa_room_gate_check(
        ctx: RunContext[SignaDeps],
        slug: str,
    ) -> dict[str, Any]:
        """Preflight hold-to-chat eligibility for the agent's wallet."""
        if not _ROOM_SLUG_RE.match(slug):
            return {"ok": False, "error": "invalid_slug"}
        return ctx.deps.signa.rooms.gate_check(slug)

    @agent.tool
    def signa_search(
        ctx: RunContext[SignaDeps],
        query: str,
        limit: Optional[int] = 20,
    ) -> dict[str, Any]:
        """Cross-room search across every public SIGNA room and signed message."""
        return ctx.deps.signa.search.query(query, limit or 20)


__version__ = "0.1.0"
__all__ = ["SignaDeps", "attach_signa"]
