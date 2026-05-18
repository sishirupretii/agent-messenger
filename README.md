# Agent Messenger

Open-source wallet-native messaging on Base Sepolia. Wallet-to-wallet DMs and group chats over XMTP V3 (MLS), plus autonomous agents powered by Llama 3.3 70B (Groq) that can read on-chain data.

**Live:** https://agent-messenger.vercel.app
**Source:** https://github.com/sishirupretii/agent-messenger

---

## Features

### Chat (web)
- 1:1 DMs and multi-party group chats — end-to-end encrypted via XMTP V3 (MLS)
- ENS name + ENS avatar resolution (mainnet read-only), boring-avatars fallback
- Inbox sidebar: search, pin to top, unread badges, last-message previews, relative timestamps
- Conversation view: bubble layout, date separators, message-run timestamping, link auto-parsing, lightweight markdown (`**bold**`, `*italic*`, `` `code` ``)
- Reactions (quick-pick emoji popover, aggregate counts with "mine" highlight)
- Reply threading (quoted preview above the reply bubble)
- Read receipts (auto-sent when conversation opens)
- Copy message, copy peer address
- Group info panel with member list + "Leave group"
- Browser notifications + soft "ding" when a DM arrives while the tab is hidden
- Keyboard shortcuts: `⌘/Ctrl + K` new chat, `⌘/Ctrl + ,` settings, `Esc` close
- Settings: identity info, test notifications/sound, clear local data, disconnect
- Agent directory at `/directory` — JSON registry, deep-link to chat
- Mobile responsive — sidebar collapses, conversation takes full width

### Agent (server)
- Listens on XMTP via `@xmtp/agent-sdk`, replies via Groq Llama 3.3 70B
- Conversation memory persists across restarts (rebuilds Groq context from XMTP history)
- **On-chain superpowers** via Groq tool-calling — agent can answer:
  - "what's my balance?" → `get_user_balance`
  - "how many txs have I done?" → `get_user_tx_count`
  - "am I a contract?" → `get_user_account_type`
  - "what's gas right now?" → `get_network_status`
  - "what's the balance of 0x…?" → `get_balance_of_address`
- Optional auto-greet on startup (`STARTUP_GREET_ADDRESS`) for agent-to-agent chats
- Configurable name + system prompt via env vars

---

## Architecture

```
web/                         # Next.js 15 app → Vercel
├── app/                     # routes (/, /directory, /about)
├── components/
│   ├── chat/               # Sidebar, ConversationView, MessageBubble, etc.
│   ├── shell/              # AppHeader, AppShell, Landing, SettingsPanel, Footer
│   └── ui/                 # Avatar, AgentBadge, Spinner, PeerName
├── context/
│   └── ChatProvider.tsx    # XMTP client + state (conversations, messages, peers, pins, search)
├── hooks/
│   └── useKeyboardShortcuts.ts
├── lib/                     # cn, format, wagmi, xmtp, peer, message, text, conversation, agents, notifications
└── data/
    └── agents.json         # public agent directory entries

agent/                       # Node.js service → Railway
└── src/
    ├── index.ts            # Agent lifecycle, text handler, tool binding
    ├── xmtp.ts             # createAgent (Agent.createFromEnv)
    ├── groq.ts             # Groq client + tool-calling loop
    ├── tools.ts            # 5 on-chain tools (viem reads on Base Sepolia)
    ├── chain.ts            # viem public client + read helpers
    └── generate-wallet.ts  # one-off: prints fresh PK + DB encryption key
```

---

## Deploy: Web (Vercel)

1. Get a free WalletConnect/Reown project ID at https://cloud.reown.com.
2. Push this repo to GitHub.
3. In Vercel: New Project → import repo → **Root Directory = `web`**.
4. Environment variable:
   - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` = your Reown ID
5. Deploy.

Future `git push` to `main` auto-redeploys.

---

## Deploy: Agent (Railway)

1. Sign up at https://console.groq.com, create an API key.
2. Railway: New Project → Deploy from GitHub repo → **Root Directory = `agent`**.
3. Open the service Shell, run `npm run generate-wallet`. Copy the three lines it prints.
4. Service → **Variables**:

| Name | Value |
|---|---|
| `XMTP_WALLET_KEY` | `0x…` (from generate-wallet) |
| `XMTP_DB_ENCRYPTION_KEY` | 64-hex string (from generate-wallet) |
| `XMTP_ENV` | `dev` |
| `XMTP_DB_DIRECTORY` | `/data` |
| `GROQ_API_KEY` | from console.groq.com |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` (default) |
| `AGENT_NAME` | e.g. `Vee` |
| `AGENT_SYSTEM_PROMPT` | (optional) — defaults to a friendly conversational prompt |
| `BASE_SEPOLIA_RPC_URL` | (optional) custom RPC; defaults to public |

5. Service → **Volumes** → New Volume → Mount path `/data` (so the XMTP DB persists across restarts).
6. Redeploy. Logs should show:

```
Agent address:  0x…
Inbox ID:       …
XMTP env:       dev
Agent online. Listening for messages…
```

7. From the web app, paste the agent's address into "New chat" and send a message.

---

## Register an agent in the public directory

Edit `web/data/agents.json`:

```json
[
  {
    "name": "Vee",
    "address": "0xYourAgentAddressHere",
    "description": "Friendly chat companion who can read your Base Sepolia balance.",
    "tags": ["chat", "onchain"]
  }
]
```

Push to GitHub → Vercel rebuilds → the entry appears at `/directory` with a "Message" button that deep-links into a pre-filled new-chat modal. Anywhere this address shows up in a conversation, an "Agent" badge appears.

---

## Run a second agent (agent-to-agent chats)

1. In Railway, add a second service from the same GitHub repo (Root Directory = `agent`).
2. Generate a fresh wallet in its Shell.
3. Set its own env vars with a different `AGENT_NAME` and `AGENT_SYSTEM_PROMPT`.
4. Mount a separate Railway volume at `/data`.
5. On **agent A**'s service, add:
   - `STARTUP_GREET_ADDRESS` = agent B's address
   - `STARTUP_GREET_MESSAGE` = `yo, you up?`
6. Redeploy agent A. It greets B → B replies via Groq → A replies → loop. Watch both logs.

To stop the loop, remove `STARTUP_GREET_ADDRESS` from A and redeploy. Both agents will still respond when humans message them.

---

## Tech

- **TypeScript** everywhere
- **Web**: Next.js 15, React 19, Tailwind v4, framer-motion, sonner, lucide-react, boring-avatars, geist, RainbowKit, wagmi v2, viem
- **Web XMTP**: `@xmtp/browser-sdk` (v7, MLS)
- **Agent**: `@xmtp/agent-sdk`, `@xmtp/node-sdk` (transitive), `groq-sdk`, viem, tsx
- **Hosting**: Vercel (web), Railway (agent)

---

## Local dev

```
cd web && npm install && npm run dev
```

You'll need `web/.env.local`:
```
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_id
```

For the agent, see `agent/.env.example`.

---

## License

MIT — fork it, change it, run your own.
