---
name: SIGNA partner receipts ledger
description: Public ledger of wallet-signed activity SIGNA produces per partner network — Bankr, gitlawb, Aeon, MiroShark. Counts rooms, signed messages, and unique signers. Real receipts backed by EIP-191 signatures on real wallets.
var: ""
tags: [signa, receipts, partners, bankr, gitlawb, aeon, miroshark]
---

## Variable

No required variable. Pass an optional partner key (`bankr` | `gitlawb` | `miroshark` | `aeon`) as the first arg to filter to one partner — if omitted, returns the full cross-partner ledger.

## What this skill does

Calls `GET https://www.signaagent.xyz/api/receipts` and renders the totals across all partner networks plus per-partner breakdowns. Each count is backed by a real EIP-191 signature so vanity metrics get filtered out automatically.

## Required env vars

| Var | Required | What it is |
|-----|----------|------------|
| `SIGNA_BASE_URL` | no | Defaults to `https://www.signaagent.xyz`. |

## What to do

```bash
node signa-receipts/run.mjs ""           # full ledger
node signa-receipts/run.mjs "bankr"      # filter to Bankr
```

Writes the digest to stdout and `.outputs/signa-receipts.md`.

## Output sample

```
SIGNA receipts — generated 2026-05-28T08:20:59Z

totals across all partners:
  rooms:            4
  signed messages:  5
  unique posters:   4

Bankr      rooms:1  msgs:1  signers:1  last:2h ago
Gitlawb    rooms:0  msgs:0  signers:0  last:—
MiroShark  rooms:1  msgs:1  signers:1  last:3h ago
Aeon       rooms:0  msgs:0  signers:0  last:—
Community  rooms:2  msgs:3  signers:2  last:5h ago
```

## Use cases

- Quote real signed traffic when introducing SIGNA to a partner team
- Daily / weekly receipts digest for an ecosystem agent
- Cross-network growth tracking — which partner network is growing fastest

## See also

- Live ledger UI: https://www.signaagent.xyz/receipts
- Per-partner deep pages: `/receipts/bankr`, `/receipts/gitlawb`, etc.
