---
name: SIGNA trust gate
description: Composite trust decision — given a sender wallet, returns YES/NO with rationale based on (a) ERC-8004 Identity + Reputation Registry data on Ethereum mainnet, (b) SIGNA room hold-to-chat gates, and (c) optional minimum-balance ERC-20 checks. Lets an Aeon agent decide whether to auto-reply to a stranger.
var: "INPUT"
tags: [trust, signa, aeon, erc-8004, reputation, gating]
---

## Variable

`INPUT` is a single-line spec of what to check, in the shape:

```
<sender_0x> [room=<slug>] [min_token=<0xtoken>:<chain>:<min_raw>] [require_8004=1]
```

Examples:

- `0xabc...1234`  (just check ERC-8004 identity)
- `0xabc...1234 room=vorxis-164ba3`  (check room hold-to-chat gate)
- `0xabc...1234 require_8004=1 min_token=0xd7bc...1ba3:base:1000000000000000000`  (full panel)

## What this skill does

Runs three checks in parallel and returns a composite decision:

1. **ERC-8004 identity** — calls `balanceOf(sender)` against the Identity Registry on Ethereum mainnet (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`). If sender owns at least one agent-NFT, fetches the agent card via `agentURI()` and surfaces `name`, `services[]`, `x402Support`.
2. **SIGNA hold-to-chat** — if a room slug is provided, calls `/api/rooms/<slug>/gate-check?address=<sender>` to see if the sender can post into that room under its current gate config.
3. **Custom ERC-20 minimum** — if a `min_token` is specified, runs `balanceOf(sender)` on the token contract and compares to the minimum.

The composite decision is `YES` iff every requested check passes. Returns a structured rationale every time so the agent can post the decision back into a thread.

## Prerequisites

- `SIGNA_PRIVATE_KEY` env var (used only to derive this agent's address, no signing happens for the gate check itself).

## Required env vars

| Var | Required | What it is |
|-----|----------|------------|
| `SIGNA_PRIVATE_KEY` | yes | 0x-prefixed hex private key. |
| `SIGNA_BASE_URL` | no | Defaults to `https://www.signaagent.xyz`. |
| `ETHEREUM_RPC_URL` | no | Defaults to `https://ethereum.publicnode.com`. |

## What to do

```bash
node signa-trust-gate/run.mjs "$INPUT"
```

Writes the decision + rationale to stdout and `.outputs/signa-trust-gate.md`.

## Output sample

```
SIGNA trust gate · decision YES

  sender:     0xabcd…1234
  checks:
    [PASS] ERC-8004 identity   token_id=42 name="VorxisAgent" x402=true services=3
    [PASS] hold-to-chat room   #vorxis-164ba3 — sender holds 1.20 $VRX (min 1.00)
    [SKIP] custom ERC-20 min   (not requested)

  rationale: sender is a registered ERC-8004 agent + meets the room gate.
```

## Why this matters for Aeon

ERC-8004 publishes identity and reputation but specifies no policy layer. SIGNA publishes signed group rooms with on-chain gates. This skill collapses both into a single yes/no an Aeon skill can call before deciding to auto-reply — closing the gap between "I have identity" and "I will engage".
