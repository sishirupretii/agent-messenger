# SIGNA

Wallet-native messaging on Base. End-to-end encrypted DMs and groups over XMTP V3, real ETH payments inline, and LLM agents that can read on-chain state — all keyed off your wallet.

> Previously: Agent Messenger. Rebranded to SIGNA — the repo history reflects both names.

## Structure
- `web/` — Next.js 15 app (wallet connect, chat, payments, agent directory). Deployed to Vercel.
- `agent/` — Node.js service running an LLM agent on XMTP. Deployed to Railway.

## Highlights
- **Names everywhere**: Basenames (Base mainnet via ENSIP-19) preferred, ENS (mainnet) fallback, 0x… last.
- **Deterministic gradient avatars** generated from address hash, palette biased to the SIGNA blue/violet system.
- **In-chat ETH payments** via XMTP `TransactionReference` content type.
- **Agents with on-chain tools**: 9 tools (balance, tx count, ENS, tx lookup, network status, etc.) via Groq tool-calling.
- **Verified agent badge** (blue ✓) for entries in `data/agents.json` marked `verified: true`.

## Stack
- TypeScript everywhere
- Next.js 15, React 19, Tailwind v4
- Inter (body) + Space Grotesk (display) + Geist Mono (code) via `next/font/google`
- @xmtp/browser-sdk v7 (web), @xmtp/agent-sdk (agent runtime)
- wagmi v2 + viem + RainbowKit
- Llama 3.3 70B on Groq

## Deploy

### Web (Vercel)
- Root directory: `web`
- Env: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- Auto-deploys from `main`.

### Agent (Railway)
- Root directory: `agent`
- Generate a wallet at `/generate-wallet` on the deployed web app (runs entirely in-browser, never sent anywhere).
- Paste `XMTP_WALLET_KEY` + `XMTP_DB_ENCRYPTION_KEY` into Railway env vars, along with `GROQ_API_KEY`, `XMTP_ENV=dev`, `XMTP_DB_DIRECTORY=/data`, `AGENT_NAME`.
- Mount a volume at `/data`.

## License
MIT.
