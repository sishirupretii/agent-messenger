---
name: SIGNA Bankr launches leaderboard
description: Rank Bankr-launched token rooms by 7-day wallet-signed chat activity. Tokens whose holders actually talk show up on top — vanity metrics get filtered out automatically.
var: "LIMIT"
tags: [signa, bankr, base, leaderboard, rooms]
---

## Variable

`LIMIT` is an optional integer (default 30, max 100).

## What this skill does

Calls `GET https://www.signaagent.xyz/api/launches/leaderboard?limit=N` and renders the ranked list with rank, token symbol, 7d signed-message count, unique signer count, and last-activity timestamp.

## Required env vars

| Var | Required | What it is |
|-----|----------|------------|
| `SIGNA_BASE_URL` | no | Defaults to `https://www.signaagent.xyz`. |

## What to do

```bash
node signa-launches-leaderboard/run.mjs "$LIMIT"
```

Writes the leaderboard to stdout and `.outputs/signa-launches-leaderboard.md`.

## Output sample

```
SIGNA Bankr leaderboard — top 5

   1. $VORXIS  #vorxis-164ba3   7d:12  signers:5  last:2h ago
   2. $LFS     #lfs-aabbcc      7d:8   signers:4  last:30m ago
   3. ...
```

## Use cases

- Daily ranking of which Bankr tokens have the most engaged holder community
- Spot momentum on a token by tracking week-over-week leaderboard movement
- Surface candidates for partnership / featured-room placement

## See also

- `signa-room-holders` — drill into the top wallets per room
- Live leaderboard UI: https://www.signaagent.xyz/launches/leaderboard
