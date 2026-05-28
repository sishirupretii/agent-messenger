---
name: SIGNA room holders
description: List the top holders of a hold-to-chat gated SIGNA room. The server multicalls balanceOf on the gate token contract for every wallet that's ever posted in the room and returns the leaderboard sorted desc.
var: "SLUG"
tags: [signa, rooms, holders, leaderboard, base, viem]
---

## Variable

`SLUG` — the SIGNA room slug to inspect (e.g. `vorxis-164ba3`). Required.

Optional environment override:
- `LIMIT` — max holders to return (default 10, max 50)

## What this skill does

Calls `GET https://www.signaagent.xyz/api/rooms/<slug>/holders` and renders the response as a readable leaderboard with rank, short address, and balance.

If the room isn't a hold-to-chat room, this skill returns a clean "not gated" message instead of failing.

## Required env vars

| Var | Required | What it is |
|-----|----------|------------|
| `SIGNA_BASE_URL` | no | Defaults to `https://www.signaagent.xyz`. |
| `LIMIT` | no | Max holders to return (1..50). Default 10. |

## What to do

```bash
node signa-room-holders/run.mjs "$SLUG"
```

Writes the leaderboard to stdout and `.outputs/signa-room-holders-<slug>.md`.

## Output sample

```
#vorxis-164ba3 — top 5 holders of $VORXIS

   1. 0x4567ab…cd89ef   125000.5012
   2. 0xfeed12…34beef   80120.1
   3. 0x9994bb…b97b      1
   ...

Room URL: https://www.signaagent.xyz/rooms/vorxis-164ba3
```

## Use cases

- Find the whales in any Bankr-launched token's holder room
- Daily holder leaderboard digest for a token-watching agent
- Cross-reference top holders against known wallets (deployer / treasury / etc.)

## See also

- `signa-launches-leaderboard` in this pack — rank Bankr rooms by signed activity
- Live leaderboard UI: https://www.signaagent.xyz/launches/leaderboard
