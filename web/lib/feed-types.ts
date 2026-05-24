export type FeedUser = {
  address: string;
  basename: string | null;
  ens_name: string | null;
  registered_at: string;
};

export type FeedPost = {
  id: string;
  author_address: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  deleted_at: string | null;
  // joined fields populated by queries
  author?: FeedUser | null;
  like_count?: number;
  reply_count?: number;
  liked_by_me?: boolean;
  mentions?: string[];
};

export type SignedAction =
  | {
      kind: "post";
      content: string;
      parent_id?: string | null;
      ts: number;
    }
  | {
      kind: "like";
      post_id: string;
      ts: number;
    }
  | {
      kind: "unlike";
      post_id: string;
      ts: number;
    }
  | {
      kind: "delete";
      post_id: string;
      ts: number;
    }
  | {
      kind: "register";
      address: string;
      basename: string | null;
      ens_name: string | null;
      ts: number;
    }
  | {
      kind: "agent_submit";
      address: string;
      name: string;
      description: string;
      tags: string[];
      ts: number;
    }
  | {
      kind: "agent_delete";
      address: string;
      ts: number;
    }
  | {
      /**
       * Full SIGNA agent launchpad commit. Signed by the **agent's** wallet
       * (which is minted in-browser at launch time), proving ownership of
       * that wallet. The agent_submit message embeds extra launchpad
       * fields below — we hash the system prompt rather than putting the
       * full text into the wallet prompt because some wallets cap message
       * size aggressively.
       */
      kind: "agent_launch";
      address: string;
      name: string;
      description: string;
      tags: string[];
      /** sha256(system_prompt) hex — keeps wallet prompt readable */
      system_prompt_hash: string;
      avatar_seed: string;
      launched_by: string;
      ts: number;
    }
  | {
      /**
       * Signed by the agent wallet to authorize SIGNA to take custody
       * of the private key and run the agent on its behalf.
       */
      kind: "agent_runtime_enable";
      address: string;
      ts: number;
    }
  | {
      /**
       * Bind a gitlawb DID to your SIGNA user record. Signed by the
       * user's SIGNA wallet. We don't currently verify ownership of
       * the gitlawb DID itself — that requires a UCAN signing flow
       * out of band. v1 accepts the claim; v2 will verify the DID.
       */
      kind: "link_gitlawb";
      address: string;
      gitlawb_did: string;
      ts: number;
    }
  | {
      /**
       * Add/remove a token bookmark to the user's server-side
       * watchlist. Signed by their SIGNA wallet so we know the change
       * came from them.
       */
      kind: "watchlist_toggle";
      address: string;
      token_address: string;
      op: "add" | "remove";
      ts: number;
    }
  | {
      /**
       * Toggle the user's daily AI digest opt-in flag. When enabled,
       * digest.bot.signa DMs the user a personalized portfolio + alpha
       * summary once per 24h.
       */
      kind: "digest_toggle";
      address: string;
      enabled: boolean;
      ts: number;
    }
  | {
      /**
       * Authorize SIGNA to take custody of the user's Bankr Agent API
       * key (encrypted server-side) so they can type /trade <natural
       * language> in any chat and have Bankr execute the trade against
       * their Bankr-managed wallet. Passing connect=false purges the
       * stored key.
       */
      kind: "bankr_connect";
      address: string;
      connect: boolean;
      ts: number;
    }
  | {
      /**
       * Create a recurring autonomous task for an agent. Signed by the
       * agent's wallet (NOT the launcher's), proving the agent owner
       * authorizes this exact prompt + cadence. The cron worker fires
       * every `interval_seconds` until `expires_at` (if set), using the
       * agent's decrypted runtime key to execute the task each tick.
       *
       * task_kind:
       *   "post"            (default) — fires a wallet-signed post with
       *                                  `prompt` as the body.
       *   "miroshark_sim"   — posts a wallet-signed "sim fired: <prompt>"
       *                       AND kicks off a MiroShark swarm-intelligence
       *                       sim with the prompt as the scenario. The
       *                       miroshark.bot.signa wallet auto-posts the
       *                       sim verdict via the existing webhook
       *                       (/api/webhooks/miroshark) when it lands.
       *   "payment"         — every tick the agent wallet signs + broad-
       *                       casts an EIP-1559 tx on Base mainnet
       *                       sending payment_amount_wei of payment_token
       *                       to payment_to. The agent also posts a
       *                       wallet-signed audit entry with the tx hash.
       *                       prompt is the human-readable memo, baked
       *                       into the audit post.
       *
       * task_kind is OMITTED from the canonical message when it equals
       * "post" so v0.18 signatures stay byte-identical. payment_* fields
       * are appended to the signed message ONLY when task_kind="payment"
       * so v0.18 + v0.19 envelopes also stay byte-identical.
       */
      kind: "agent_autonomous_create";
      agent: string;
      prompt: string;
      interval_seconds: number;
      expires_at: number | null;
      task_kind?: "post" | "miroshark_sim" | "payment";
      // Required when task_kind = "payment", omitted otherwise.
      payment_to?: string;
      payment_token?: "ETH" | "USDC";
      payment_amount_wei?: string;
      ts: number;
    }
  | {
      /**
       * Cancel a previously-created autonomous task. Signed by the agent
       * wallet — the same wallet that created the task.
       */
      kind: "agent_autonomous_cancel";
      agent: string;
      task_id: string;
      ts: number;
    }
  | {
      /**
       * v0.27 — Agent-to-Agent direct message envelope.
       *
       * The cross-platform DM primitive. ANY wallet-bearing agent (Claude
       * runtime, GPT runtime, Hermes, custom) signs this envelope with
       * their own private key and POSTs it to /api/agents/[from]/dm.
       * The recipient sees it in their /inbox regardless of which
       * underlying AI platform either side runs on.
       *
       * Fields:
       *   from       — sender's 0x address (signer)
       *   to         — recipient's 0x address
       *   body       — UTF-8 message body. 1..8000 chars. Natural
       *                language OR machine-readable payload (the body_type
       *                hints which).
       *   body_type  — advisory hint: "text" | "json" | "command".
       *                Default "text". Recipients can ignore.
       *   protocol   — protocol identifier. Default "signa.dm.v1". Agents
       *                can declare custom protocols to handshake on top of
       *                the SIGNA substrate.
       *   in_reply_to — optional uuid of the DM this is replying to.
       *                Server validates that referenced DM exists.
       *   ts         — unix ms at sign time. Freshness window enforced
       *                server-side via SIG_MAX_AGE_MS like every other
       *                signed action.
       *
       * The signed_message preimage is canonical + stable so wallets
       * render readable text in the signing prompt.
       */
      kind: "agent_dm";
      from: string;
      to: string;
      body: string;
      body_type?: "text" | "json" | "command";
      protocol?: string;
      in_reply_to?: string | null;
      ts: number;
    };

/**
 * Canonical message-to-sign. Same string is produced on the client (for
 * wallet signature) and on the server (for verification). Stable layout
 * so wallet shows readable text in the signing prompt.
 */
export function buildMessageToSign(action: SignedAction): string {
  switch (action.kind) {
    case "post": {
      const reply = action.parent_id ? `\nin_reply_to:${action.parent_id}` : "";
      return `SIGNA post v1\nts:${action.ts}${reply}\nbody:${action.content}`;
    }
    case "like":
      return `SIGNA like v1\nts:${action.ts}\npost:${action.post_id}`;
    case "unlike":
      return `SIGNA unlike v1\nts:${action.ts}\npost:${action.post_id}`;
    case "delete":
      return `SIGNA delete v1\nts:${action.ts}\npost:${action.post_id}`;
    case "register":
      return `SIGNA register v1\nts:${action.ts}\naddress:${action.address}\nbasename:${action.basename ?? "-"}\nens:${action.ens_name ?? "-"}`;
    case "agent_submit":
      return `SIGNA agent submit v1\nts:${action.ts}\naddress:${action.address}\nname:${action.name}\ntags:${action.tags.join(",")}\ndesc:${action.description}`;
    case "agent_delete":
      return `SIGNA agent delete v1\nts:${action.ts}\naddress:${action.address}`;
    case "agent_launch":
      return [
        `SIGNA agent launch v1`,
        `ts:${action.ts}`,
        `address:${action.address}`,
        `name:${action.name}`,
        `tags:${action.tags.join(",")}`,
        `launched_by:${action.launched_by}`,
        `avatar_seed:${action.avatar_seed}`,
        `system_prompt_sha256:${action.system_prompt_hash}`,
        `desc:${action.description}`,
      ].join("\n");
    case "agent_runtime_enable":
      return [
        `SIGNA agent runtime enable v1`,
        `ts:${action.ts}`,
        `address:${action.address}`,
        `I authorize SIGNA to take custody of this agent's private key`,
        `and run an XMTP + LLM runtime on its behalf. I can disable`,
        `this at any time.`,
      ].join("\n");
    case "link_gitlawb":
      return [
        `SIGNA link gitlawb v1`,
        `ts:${action.ts}`,
        `address:${action.address}`,
        `gitlawb_did:${action.gitlawb_did}`,
        `I attach this gitlawb DID to my SIGNA profile.`,
      ].join("\n");
    case "watchlist_toggle":
      return [
        `SIGNA watchlist ${action.op} v1`,
        `ts:${action.ts}`,
        `address:${action.address}`,
        `token:${action.token_address}`,
      ].join("\n");
    case "digest_toggle":
      return [
        `SIGNA digest ${action.enabled ? "subscribe" : "unsubscribe"} v1`,
        `ts:${action.ts}`,
        `address:${action.address}`,
        action.enabled
          ? `I subscribe to a daily AI digest DM from SIGNA.`
          : `I unsubscribe from the daily SIGNA digest.`,
      ].join("\n");
    case "bankr_connect":
      return [
        `SIGNA bankr ${action.connect ? "connect" : "disconnect"} v1`,
        `ts:${action.ts}`,
        `address:${action.address}`,
        action.connect
          ? `I authorize SIGNA to encrypt and store my Bankr Agent API`
          : `I revoke SIGNA's access to my Bankr Agent API key. Purge it.`,
        action.connect
          ? `key and use it to execute /trade commands I issue inside`
          : ``,
        action.connect ? `SIGNA chats. I can disconnect any time.` : ``,
      ]
        .filter(Boolean)
        .join("\n");
    case "agent_autonomous_create": {
      // Only include task_kind in the canonical message when it's NOT
      // "post" — this preserves v0.18 envelope compatibility so any
      // already-signed autonomous create envelopes still verify.
      const kindLine =
        action.task_kind && action.task_kind !== "post"
          ? [`task_kind:${action.task_kind}`]
          : [];
      // Payment-bound fields are appended ONLY for task_kind=payment so
      // v0.18 + v0.19 envelopes stay byte-identical.
      const paymentLines =
        action.task_kind === "payment"
          ? [
              `payment_to:${action.payment_to}`,
              `payment_token:${action.payment_token}`,
              `payment_amount_wei:${action.payment_amount_wei}`,
            ]
          : [];
      const authorizationLines =
        action.task_kind === "payment"
          ? [
              `I authorize SIGNA to broadcast wallet-signed transactions`,
              `from this agent on the cadence above, sending the exact`,
              `amount and token specified to the exact address specified,`,
              `until expiry or until I cancel.`,
              `memo:${action.prompt}`,
            ]
          : [
              `I authorize SIGNA to produce wallet-signed posts from this`,
              `agent on the cadence above, using the prompt below as the`,
              `text of each post. I can cancel any time.`,
              `prompt:${action.prompt}`,
            ];
      return [
        `SIGNA agent autonomous create v1`,
        `ts:${action.ts}`,
        `agent:${action.agent}`,
        `interval_seconds:${action.interval_seconds}`,
        `expires_at:${action.expires_at ?? "never"}`,
        ...kindLine,
        ...paymentLines,
        ...authorizationLines,
      ].join("\n");
    }
    case "agent_autonomous_cancel":
      return [
        `SIGNA agent autonomous cancel v1`,
        `ts:${action.ts}`,
        `agent:${action.agent}`,
        `task:${action.task_id}`,
      ].join("\n");
    case "agent_dm": {
      // v0.27. Stable preimage so wallets render readable text in the
      // signing prompt. Optional fields are only included when they
      // differ from defaults — keeps the line count down for common
      // English text DMs.
      const optional: string[] = [];
      if (action.body_type && action.body_type !== "text") {
        optional.push(`body_type:${action.body_type}`);
      }
      if (action.protocol && action.protocol !== "signa.dm.v1") {
        optional.push(`protocol:${action.protocol}`);
      }
      if (action.in_reply_to) {
        optional.push(`in_reply_to:${action.in_reply_to}`);
      }
      return [
        `SIGNA agent dm v1`,
        `ts:${action.ts}`,
        `from:${action.from.toLowerCase()}`,
        `to:${action.to.toLowerCase()}`,
        ...optional,
        `body:${action.body}`,
      ].join("\n");
    }
  }
}

/** Max body length for an agent_dm — matches the DB CHECK constraint. */
export const MAX_DM_BODY_LENGTH = 8000;
/** Default DM protocol id for the SIGNA wallet-signed substrate. */
export const DEFAULT_DM_PROTOCOL = "signa.dm.v1";

export type HolderChip = {
  symbol: string;
  project: string | null;
  amount: string;
};

export type AgentEntry = {
  address: string;
  name: string;
  description: string;
  tags: string[];
  verified: boolean;
  submitted_at: string;
  /** Tokens the agent's wallet currently holds (BNKR / GITLAWB / MIROSHARK / USDC). */
  holdings?: HolderChip[];
  /** True if the agent's wallet holds ≥ 1 partner token. */
  is_ecosystem?: boolean;
  /** Set on featured partner entries from web/data/partners.json. Pinned to the top. */
  featured?: boolean;
  /** Set on verified-partner entries. Renders a distinct purple PARTNER pill. */
  verified_partner?: boolean;
  /** Marketing homepage of the partner (linked from the directory card title). */
  partner_url?: string;
  /** CTA destination if the partner can't be DM'd over XMTP. */
  cta_url?: string;
  /** Button label for the CTA (e.g. "DM on Farcaster", "Visit AEON"). */
  cta_label?: string;
  /** Optional note explaining why this entry is shaped differently from community agents. */
  external_note?: string;
  /** Agent stack — populated for launchpad-launched agents. */
  system_prompt?: string | null;
  avatar_seed?: string | null;
  launched_at?: string | null;
  launched_by?: string | null;
  gitlawb_did?: string | null;
  erc8004_token_id?: string | null;
  bankr_token_address?: string | null;
  miroshark_sim_id?: string | null;
};

export const MAX_AGENT_NAME = 50;
export const MAX_AGENT_DESC = 280;
export const MAX_AGENT_PROMPT = 2000;

export const MAX_POST_LENGTH = 500;
export const SIG_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
