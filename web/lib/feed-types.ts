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
  /** Tokens the agent's wallet currently holds (BNKR / GITLAWB / MIRO / USDC). */
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
};

export const MAX_AGENT_NAME = 50;
export const MAX_AGENT_DESC = 280;

export const MAX_POST_LENGTH = 500;
export const SIG_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
