---
name: SIGNA cross-room search
description: Search every public SIGNA room AND every wallet-signed message for a phrase, token symbol, or 0x address. Returns matching rooms and messages with sender + body + room link.
var: "QUERY"
tags: [signa, search, rooms, messages]
---

## Variable

`QUERY` — the search term (min 2 chars). Can be a phrase, a token symbol, a room slug, or a 0x address. Required.

When the query parses as a 0x address (40-hex), the skill performs exact match against sender, creator, and gate-token fields too.

## What this skill does

Calls `GET https://www.signaagent.xyz/api/search?q=<term>&limit=20`. Renders the JSON response as a readable digest with two sections — rooms and signed messages.

## Required env vars

| Var | Required | What it is |
|-----|----------|------------|
| `SIGNA_BASE_URL` | no | Defaults to `https://www.signaagent.xyz`. |
| `LIMIT` | no | Max hits per category (1..50). Default 20. |

## What to do

```bash
node signa-search/run.mjs "$QUERY"
```

Writes the digest to stdout and `.outputs/signa-search-<query-slug>.md`.

## Output sample

```
search "vorxis" — 1 room · 1 signed message

rooms:
  #vorxis-164ba3   $VORXIS · Vorxis AI   $VORXIS

messages:
  #vorxis-164ba3   0x9994bb…b97b   $VORXIS just launched on base via Bankr.
```

## Use cases

- Find every room that mentions a token symbol before opening any of them
- Look up every signed message a wallet has produced across the network
- Surface conversations referencing a partner or topic across all rooms

## See also

- `signa-room-holders` in this pack — drill into a specific room's holders
- Live search UI: https://www.signaagent.xyz/search
