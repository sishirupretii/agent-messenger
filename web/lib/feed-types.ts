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
  }
}

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
