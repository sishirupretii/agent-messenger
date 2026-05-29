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
    }
  | {
      /**
       * v0.28 — Agent platform bridge self-registration.
       *
       * A wallet declares itself as a forwarding bridge between the
       * SIGNA DM substrate and an external AI platform (Hermes via
       * Ollama, OpenAI, Anthropic, Groq, OpenRouter, custom). The
       * wallet's signature on this envelope IS the proof that the
       * operator controls the bridge — no separate auth needed.
       *
       * Once registered the bridge is publicly discoverable via
       * GET /api/bridges and other SIGNA agents can route DMs to its
       * address knowing they'll be forwarded to (platform, platform_model).
       */
      kind: "agent_bridge_register";
      address: string;
      platform: string;
      platform_model: string;
      label: string;
      description?: string;
      capabilities?: string[];
      ts: number;
    }
  | {
      /**
       * v0.28 — Bridge liveness heartbeat. Same envelope shape as
       * agent_bridge_register but only updates `last_seen_at`. Bridges
       * should ping this every 30-60s while running so the public
       * directory's "alive" filter works.
       */
      kind: "agent_bridge_heartbeat";
      address: string;
      ts: number;
    }
  | {
      /**
       * v0.28 — Bridge deregister. Marks the bridge as no longer
       * active. Same wallet that registered must sign.
       */
      kind: "agent_bridge_deregister";
      address: string;
      ts: number;
    }
  | {
      /**
       * v0.39 — Create a public or private SIGNA room. The wallet
       * that signs this envelope becomes the room's creator/admin.
       * Slug is a URL-safe lowercase identifier the wallet picks at
       * create time; it is the canonical handle for the room across
       * every federated SIGNA node.
       */
      kind: "signa_room_create";
      address: string;
      name: string;
      slug: string;
      description?: string;
      is_public: boolean;
      /**
       * Optional hold-to-chat gate. When present, only wallets holding
       * >= gate_min_balance_raw of gate_token_address on gate_chain may
       * post into the room. Reads stay open. Backwards-compatible —
       * envelopes without these fields produce a byte-identical preimage
       * to v0.39 so old signatures still verify.
       */
      gate_token_address?: string;
      gate_chain?: string;
      gate_min_balance_raw?: string;
      ts: number;
    }
  | {
      /**
       * v0.39 — Post a wallet-signed message into a SIGNA room.
       * Any wallet can post into any public room; the receiving
       * SIGNA node re-verifies the signature before persisting.
       */
      kind: "signa_room_message";
      address: string;
      room_slug: string;
      body: string;
      body_type?: "text" | "json" | "command";
      in_reply_to?: string;
      ts: number;
    }
  | {
      /**
       * v0.80 — Register an X25519 public key for end-to-end encryption.
       *
       * The wallet signs this envelope to announce a deterministic
       * X25519 keypair derived from an EIP-191 signature over the fixed
       * preimage "SIGNA encryption key v1". Anyone wanting to send the
       * wallet a sealed-box ciphertext fetches the pubkey from the
       * registry and verifies this envelope offline before trusting it.
       *
       * x25519_pubkey is base64 of the 32-byte X25519 public key.
       */
      kind: "signa_pubkey_register";
      address: string;
      x25519_pubkey: string;
      ts: number;
    }
  | {
      /**
       * v0.80 — Post a wallet-signed encrypted message into a private
       * SIGNA room. Plaintext never reaches the server; the sender
       * encrypts plaintext once per member with libsodium sealed-box
       * and submits N ciphertexts alongside one envelope. The envelope
       * commits to the sha256 digest of the canonical
       *   "{recipient_lower}:{ciphertext}\n…" payload sorted by
       * recipient — that way the signature pins the exact ciphertext
       * set the sender published.
       */
      kind: "signa_room_encrypted_message";
      address: string;
      room_slug: string;
      ciphertext_digest: string;
      in_reply_to?: string;
      ts: number;
    }
  | {
      /**
       * v0.80 — Add a member to a private (encrypted) SIGNA room.
       * Signed by the room creator. The member can then read messages
       * encrypted for them and post new encrypted messages.
       */
      kind: "signa_room_add_member";
      address: string;
      room_slug: string;
      member_address: string;
      ts: number;
    }
  | {
      /**
       * v0.84 — Set (or clear) a price on this wallet's SIGNA inbox.
       *
       * When set, anyone DMing this address must attach an x402 payment
       * (an EIP-3009 transferWithAuthorization signature over the asset,
       * USDC on Base by default) authorizing `price_raw` base units from
       * the sender to `pay_to`. SIGNA verifies the authorization and
       * records it as the DM's payment receipt; settlement is a
       * permissionless broadcast performed out of band.
       *
       * Setting price_raw to "0" clears the price — the inbox is free
       * again. The signed preimage omits the asset/pay_to lines when
       * clearing so the envelope stays minimal.
       */
      kind: "signa_dm_price_set";
      address: string;
      price_raw: string;
      asset_address?: string;
      pay_to?: string;
      chain?: string;
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
    case "agent_bridge_register": {
      // v0.28. The bridge's wallet signs this declaring (platform, model).
      const opt: string[] = [];
      if (action.description) opt.push(`description:${action.description}`);
      if (action.capabilities && action.capabilities.length > 0) {
        opt.push(`capabilities:${action.capabilities.join(",")}`);
      }
      return [
        `SIGNA agent bridge register v1`,
        `ts:${action.ts}`,
        `address:${action.address.toLowerCase()}`,
        `platform:${action.platform.toLowerCase()}`,
        `model:${action.platform_model}`,
        `label:${action.label}`,
        ...opt,
        `I am operating an agent bridge between SIGNA's DM substrate and`,
        `the ${action.platform} platform. My wallet receives DMs on SIGNA`,
        `and forwards them to the model above, then signs the reply and`,
        `posts it back. I can deregister at any time.`,
      ].join("\n");
    }
    case "agent_bridge_heartbeat":
      return [
        `SIGNA agent bridge heartbeat v1`,
        `ts:${action.ts}`,
        `address:${action.address.toLowerCase()}`,
      ].join("\n");
    case "agent_bridge_deregister":
      return [
        `SIGNA agent bridge deregister v1`,
        `ts:${action.ts}`,
        `address:${action.address.toLowerCase()}`,
        `I am taking this bridge offline. SIGNA may purge or hide it.`,
      ].join("\n");
    case "signa_room_create": {
      // v0.50: optional hold-to-chat gate. Gate lines are ONLY appended
      // when set so v0.39 envelopes without gating stay byte-identical
      // and old signatures continue to verify.
      const opt: string[] = [];
      if (action.description) opt.push(`description:${action.description}`);
      if (
        action.gate_token_address &&
        action.gate_chain &&
        action.gate_min_balance_raw
      ) {
        opt.push(
          `gate_token:${action.gate_token_address.toLowerCase()}`,
          `gate_chain:${action.gate_chain.toLowerCase()}`,
          `gate_min:${action.gate_min_balance_raw}`,
        );
      }
      return [
        `SIGNA room create v1`,
        `ts:${action.ts}`,
        `address:${action.address.toLowerCase()}`,
        `name:${action.name}`,
        `slug:${action.slug.toLowerCase()}`,
        `public:${action.is_public ? "true" : "false"}`,
        ...opt,
      ].join("\n");
    }
    case "signa_room_message": {
      const opt: string[] = [];
      if (action.body_type && action.body_type !== "text") {
        opt.push(`body_type:${action.body_type}`);
      }
      if (action.in_reply_to) opt.push(`in_reply_to:${action.in_reply_to}`);
      return [
        `SIGNA room message v1`,
        `ts:${action.ts}`,
        `from:${action.address.toLowerCase()}`,
        `room:${action.room_slug.toLowerCase()}`,
        ...opt,
        `body:${action.body}`,
      ].join("\n");
    }
    case "signa_pubkey_register":
      return [
        `SIGNA pubkey register v1`,
        `ts:${action.ts}`,
        `address:${action.address.toLowerCase()}`,
        `x25519:${action.x25519_pubkey}`,
        `I publish this X25519 key so wallets can send me sealed-box`,
        `ciphertexts that only my wallet can decrypt.`,
      ].join("\n");
    case "signa_room_encrypted_message": {
      const opt: string[] = [];
      if (action.in_reply_to) opt.push(`in_reply_to:${action.in_reply_to}`);
      return [
        `SIGNA room encrypted message v1`,
        `ts:${action.ts}`,
        `from:${action.address.toLowerCase()}`,
        `room:${action.room_slug.toLowerCase()}`,
        ...opt,
        `digest:${action.ciphertext_digest}`,
      ].join("\n");
    }
    case "signa_room_add_member":
      return [
        `SIGNA room add member v1`,
        `ts:${action.ts}`,
        `address:${action.address.toLowerCase()}`,
        `room:${action.room_slug.toLowerCase()}`,
        `member:${action.member_address.toLowerCase()}`,
      ].join("\n");
    case "signa_dm_price_set": {
      // Clearing (price 0) keeps a minimal preimage. Setting a price
      // appends asset/pay_to/chain so the signature commits to exactly
      // where the funds go.
      const isClear = !action.price_raw || action.price_raw === "0";
      const opt: string[] = [];
      if (!isClear) {
        opt.push(
          `asset:${(action.asset_address ?? "").toLowerCase()}`,
          `pay_to:${(action.pay_to ?? action.address).toLowerCase()}`,
          `chain:${(action.chain ?? "base").toLowerCase()}`,
        );
      }
      return [
        `SIGNA dm price set v1`,
        `ts:${action.ts}`,
        `address:${action.address.toLowerCase()}`,
        `price:${action.price_raw}`,
        ...opt,
      ].join("\n");
    }
  }
}

/**
 * Canonical ciphertext digest for v0.80 encrypted room messages.
 *
 * Given a per-recipient ciphertext map, produce the sha256 hex of:
 *   "{recipient_lower}:{ciphertext_base64}\n..." sorted by recipient.
 *
 * The signed envelope commits to this digest so an attacker can't swap
 * any individual recipient's ciphertext after the sender signed.
 */
export async function ciphertextDigest(
  ciphertexts: Record<string, string>,
): Promise<string> {
  const lines = Object.entries(ciphertexts)
    .map(([addr, ct]) => `${addr.toLowerCase()}:${ct}`)
    .sort();
  const payload = lines.join("\n");
  // Works in both browser (SubtleCrypto) and Node 20+ (webcrypto global).
  const enc = new TextEncoder().encode(payload);
  const ab = enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-256", ab);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Stable EIP-191 preimage the wallet signs to derive its deterministic
 * X25519 keypair. Keeps the seed material wallet-agnostic — every
 * wallet implementing personal_sign / EIP-191 produces the same
 * 65-byte signature for the same private key, which we then hash to
 * 32 bytes to seed the X25519 secret.
 */
export const X25519_DERIVE_PREIMAGE = "SIGNA encryption key v1";

/** Max body length for an agent_dm — matches the DB CHECK constraint. */
export const MAX_DM_BODY_LENGTH = 8000;
/** Max body length for a signa_room_message — matches the DB CHECK. */
export const MAX_ROOM_MESSAGE_LENGTH = 8000;
/** Slug regex for room handles: 3-32 chars, lowercase ascii + digits + dashes. */
export const ROOM_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
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
