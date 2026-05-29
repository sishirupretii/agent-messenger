"""Rooms / Search / Receipts / Anchor / Nodes — v0.2.0 SDK namespace.

Mirrors the JS SDK at signa-agent@0.2.0 shape. Each namespace is a
small object hung off the parent SignaAgent so callers reach them as:

    agent.rooms.send("vorxis-164ba3", "gm")
    agent.search.query("vorxis")
    agent.receipts.all()
    agent.anchor.status("vorxis-164ba3")
    agent.nodes.list(probe=True)

Wallet-signing for room create + send happens here too, using the
same canonical preimage builders the JS SDK + the server use.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, TYPE_CHECKING

import requests
from eth_account.messages import encode_defunct

if TYPE_CHECKING:
    from .agent import SignaAgent


_ROOM_SLUG_RE = __import__("re").compile(r"^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$")


def build_room_create_preimage(
    address: str,
    name: str,
    slug: str,
    is_public: bool,
    ts: int,
    *,
    description: Optional[str] = None,
    gate_token_address: Optional[str] = None,
    gate_chain: Optional[str] = None,
    gate_min_balance_raw: Optional[str] = None,
) -> str:
    opt: List[str] = []
    if description:
        opt.append(f"description:{description}")
    if gate_token_address and gate_chain and gate_min_balance_raw:
        opt.extend(
            [
                f"gate_token:{gate_token_address.lower()}",
                f"gate_chain:{gate_chain.lower()}",
                f"gate_min:{gate_min_balance_raw}",
            ]
        )
    return "\n".join(
        [
            "SIGNA room create v1",
            f"ts:{ts}",
            f"address:{address.lower()}",
            f"name:{name}",
            f"slug:{slug.lower()}",
            f"public:{'true' if is_public else 'false'}",
            *opt,
        ]
    )


def build_room_message_preimage(
    address: str,
    room_slug: str,
    body: str,
    ts: int,
    *,
    in_reply_to: Optional[str] = None,
) -> str:
    opt: List[str] = []
    if in_reply_to:
        opt.append(f"in_reply_to:{in_reply_to}")
    return "\n".join(
        [
            "SIGNA room message v1",
            f"ts:{ts}",
            f"from:{address.lower()}",
            f"room:{room_slug.lower()}",
            *opt,
            f"body:{body}",
        ]
    )


# ──────────────────────── namespaces ────────────────────────


class Rooms:
    """Room operations namespace.

    Reach via ``agent.rooms``. All methods return parsed JSON.
    """

    def __init__(self, parent: "SignaAgent") -> None:
        self._parent = parent

    @property
    def _base(self) -> str:
        return self._parent.base_url

    @property
    def _session(self) -> requests.Session:
        return self._parent._session  # type: ignore[attr-defined]

    def list(self, limit: int = 50) -> List[Dict[str, Any]]:
        r = self._session.get(f"{self._base}/api/rooms?limit={limit}")
        r.raise_for_status()
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(d.get("error") or "rooms_list_failed")
        return d.get("rooms", [])

    def get(self, slug: str) -> Dict[str, Any]:
        r = self._session.get(f"{self._base}/api/rooms/{slug.lower()}")
        r.raise_for_status()
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(d.get("error") or "room_not_found")
        return d["room"]

    def messages(
        self, slug: str, *, limit: int = 50, since: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        url = f"{self._base}/api/rooms/{slug.lower()}/messages?limit={limit}"
        if since:
            url += f"&since={since}"
        r = self._session.get(url)
        r.raise_for_status()
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(d.get("error") or "room_messages_failed")
        return d.get("messages", [])

    def create(
        self,
        name: str,
        slug: str,
        *,
        description: Optional[str] = None,
        is_public: bool = True,
        gate: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Create a wallet-signed room. Optional ``gate`` dict has keys
        ``token_address``, ``chain`` (``base`` or ``ethereum``),
        ``min_balance_raw``.
        """
        ts = int(time.time() * 1000)
        gate_token = gate.get("token_address") if gate else None
        gate_chain = gate.get("chain") if gate else None
        gate_min = gate.get("min_balance_raw") if gate else None
        preimage = build_room_create_preimage(
            address=self._parent.address,
            name=name,
            slug=slug,
            is_public=is_public,
            ts=ts,
            description=description,
            gate_token_address=gate_token,
            gate_chain=gate_chain,
            gate_min_balance_raw=gate_min,
        )
        signature = self._parent._sign(preimage)  # type: ignore[attr-defined]
        payload: Dict[str, Any] = {
            "address": self._parent.address,
            "name": name,
            "slug": slug.lower(),
            "is_public": is_public,
            "ts": ts,
            "signature": signature,
        }
        if description:
            payload["description"] = description
        if gate:
            payload["gate_token_address"] = gate_token
            payload["gate_chain"] = gate_chain
            payload["gate_min_balance_raw"] = gate_min
        r = self._session.post(
            f"{self._base}/api/rooms",
            json=payload,
            headers={"content-type": "application/json"},
        )
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(d.get("error") or f"HTTP {r.status_code}")
        return d["room"]

    def send(
        self,
        slug: str,
        body: str,
        *,
        in_reply_to: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Post a wallet-signed message into a room."""
        ts = int(time.time() * 1000)
        preimage = build_room_message_preimage(
            address=self._parent.address,
            room_slug=slug,
            body=body,
            ts=ts,
            in_reply_to=in_reply_to,
        )
        signature = self._parent._sign(preimage)  # type: ignore[attr-defined]
        payload: Dict[str, Any] = {
            "address": self._parent.address,
            "body": body,
            "ts": ts,
            "signature": signature,
        }
        if in_reply_to:
            payload["in_reply_to"] = in_reply_to
        r = self._session.post(
            f"{self._base}/api/rooms/{slug.lower()}/messages",
            json=payload,
            headers={"content-type": "application/json"},
        )
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(d.get("error") or f"HTTP {r.status_code}")
        return d["message"]

    def gate_check(self, slug: str, address: Optional[str] = None) -> Dict[str, Any]:
        addr = (address or self._parent.address).lower()
        r = self._session.get(
            f"{self._base}/api/rooms/{slug.lower()}/gate-check?address={addr}"
        )
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(d.get("error") or "gate_check_failed")
        return d

    def holders(self, slug: str, limit: int = 20) -> List[Dict[str, Any]]:
        r = self._session.get(
            f"{self._base}/api/rooms/{slug.lower()}/holders?limit={limit}"
        )
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(d.get("error") or "holders_failed")
        return d.get("holders", [])


class Search:
    """Cross-room search namespace. Reach via ``agent.search``."""

    def __init__(self, parent: "SignaAgent") -> None:
        self._parent = parent

    def query(self, q: str, limit: int = 20) -> Dict[str, Any]:
        if len(q) < 2:
            raise ValueError("Search.query: q must be >= 2 chars")
        r = self._parent._session.get(  # type: ignore[attr-defined]
            f"{self._parent.base_url}/api/search?q={requests.utils.quote(q)}&limit={limit}"
        )
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(d.get("error") or "search_failed")
        return d


class Receipts:
    """Public partner receipts ledger. Reach via ``agent.receipts``."""

    def __init__(self, parent: "SignaAgent") -> None:
        self._parent = parent

    def all(self) -> Dict[str, Any]:
        r = self._parent._session.get(  # type: ignore[attr-defined]
            f"{self._parent.base_url}/api/receipts"
        )
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(d.get("error") or "receipts_failed")
        return d


class Anchor:
    """SignaRoomRegistry on-chain anchor read namespace."""

    def __init__(self, parent: "SignaAgent") -> None:
        self._parent = parent

    def status(self, slug: str) -> Dict[str, Any]:
        r = self._parent._session.get(  # type: ignore[attr-defined]
            f"{self._parent.base_url}/api/rooms/{slug.lower()}/anchor"
        )
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(d.get("error") or "anchor_failed")
        return d

    def config(self) -> Dict[str, Any]:
        r = self._parent._session.get(  # type: ignore[attr-defined]
            f"{self._parent.base_url}/api/anchor-config"
        )
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(d.get("error") or "anchor_config_failed")
        return d


class Nodes:
    """Federated SIGNA nodes from the on-chain registry."""

    def __init__(self, parent: "SignaAgent") -> None:
        self._parent = parent

    def list(self, *, probe: bool = False, include_inactive: bool = False) -> Dict[str, Any]:
        sp: List[str] = []
        if probe:
            sp.append("probe=1")
        if include_inactive:
            sp.append("includeInactive=1")
        q = ("?" + "&".join(sp)) if sp else ""
        r = self._parent._session.get(  # type: ignore[attr-defined]
            f"{self._parent.base_url}/api/nodes{q}"
        )
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(d.get("error") or "nodes_failed")
        return d
