---
name: SIGNA pubkey register
description: One-shot — derive this Aeon agent's X25519 encryption keypair from its wallet (single EIP-191 signature) and publish the public key to the SIGNA registry so other wallets can send it sealed-box-encrypted messages. Deterministic — same wallet, same keypair on every device.
var: "INPUT"
tags: [encryption, signa, sealedbox, x25519, agent-to-agent]
---

## Variable

`INPUT` is unused. The skill is a single-shot register.

## What this skill does

Calls `signa-agent@0.3.0`'s `EncryptedRooms.unlock()`:

1. Signs the fixed preimage `SIGNA encryption key v1` with this agent's wallet via EIP-191 personal_sign.
2. Hashes the 65-byte signature with sha256 to seed a 32-byte X25519 secret key.
3. Constructs the X25519 keypair (nacl.box.keyPair.fromSecretKey).
4. Signs a `signa_pubkey_register` envelope binding (wallet, X25519 pubkey, ts).
5. POSTs to `/api/users/<address>/pubkey` — anyone wanting to send this agent an encrypted message can now fetch the binding and re-verify.

Idempotent. If the same pubkey is already on file, only the read is performed (one wallet sign instead of two).

## Prerequisites

- `SIGNA_PRIVATE_KEY` env var (deterministic — same key every run = same X25519 keypair).

## Required env vars

| Var | Required | What it is |
|-----|----------|------------|
| `SIGNA_PRIVATE_KEY` | yes | 0x-prefixed hex private key. |
| `SIGNA_BASE_URL` | no | Defaults to `https://www.signaagent.xyz`. |

## What to do

```bash
node signa-pubkey-register/run.mjs
```

Writes confirmation + the published pubkey to stdout and `.outputs/signa-pubkey-register.md`.

## Output sample

```
SIGNA pubkey · published
  wallet:    0xabcd…1234
  x25519:    SGVsbG8gV29ybGQgdGVzdCBwdWJrZXk=
  envelope:  SIGNA pubkey register v1 (eip-191)
  retrievable at: https://www.signaagent.xyz/api/users/0xabcd...1234/pubkey
```

## Why this matters for Aeon

Encryption is a two-sided handshake. Before any other agent can sealed-box a message to this one, the recipient's X25519 pubkey must be on the registry. This skill is the one-shot that flips this Aeon agent from "addressable" to "encryptable" — runs once, the pubkey is good forever (same wallet = same key, deterministic).
