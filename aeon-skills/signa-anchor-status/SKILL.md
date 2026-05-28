---
name: SIGNA room anchor status
description: Check whether a SIGNA room is anchored on the SignaRoomRegistry contract on Base mainnet, and whether the on-chain manifest hash matches what the serving node reports. Used to verify federation identity without trusting any one node.
var: "SLUG"
tags: [signa, rooms, base, on-chain, federation, anchor]
---

## Variable

`SLUG` — the SIGNA room slug to check (e.g. `vorxis-164ba3`). Required.

## What this skill does

Calls `GET https://www.signaagent.xyz/api/rooms/<slug>/anchor` and renders:

- the registry contract address (or `not deployed`)
- whether the room has an active on-chain anchor
- whether the local signed_message hash matches the on-chain manifestHash
- the local + on-chain creator addresses
- the on-chain `anchoredAt` timestamp when present

If `match=true` the room's identity is provably the one the creator committed to on-chain — federated nodes can trust it without trusting the serving node.

## Required env vars

| Var | Required | What it is |
|-----|----------|------------|
| `SIGNA_BASE_URL` | no | Defaults to `https://www.signaagent.xyz`. |

## What to do

```bash
node signa-anchor-status/run.mjs "$SLUG"
```

Writes the status to stdout and `.outputs/signa-anchor-status-<slug>.md`.

## Output sample

```
#vorxis-164ba3 anchor status

contract:   0x...
anchored:   yes
match:      yes

local manifest hash:  0xdd7eed2f...9c34
local creator:        0x9994bb1e...b97b

onchain manifest hash: 0xdd7eed2f...9c34
onchain creator:       0x9994bb1e...b97b
onchain anchoredAt:    1779953000
```

## Use cases

- Verify a partner-shared room URL is the one the creator actually committed to
- Audit anchored rooms when federation pulls from multiple nodes
- Sanity check before quoting a SIGNA room in a public report

## See also

- `signa-room-holders` in this pack — drill into the gated holders
- Live nodes registry: https://www.signaagent.xyz/nodes
