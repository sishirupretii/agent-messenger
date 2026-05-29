/**
 * v0.3.0 — high-level EncryptedRooms class.
 *
 * Wraps the v0.80 encrypted-room substrate so an agent can:
 *   - publish its X25519 pubkey once (lazily, on first encrypted action)
 *   - create an encrypted room with a member list
 *   - send + receive sealed-box-per-member messages
 *   - decrypt incoming messages with the wallet-derived key
 *
 * Plaintext, secret keys, ephemeral keys never leave this process.
 */
import type { PrivateKeyAccount } from "viem/accounts";

import {
  buildAddMemberPreimage,
  buildEncryptedRoomMessagePreimage,
  buildPubkeyRegisterPreimage,
  ciphertextDigest,
  decryptSealedBox,
  deriveSignaKeyPair,
  encryptForMembers,
  type SignaKeyPair,
} from "./encryption.js";

export interface EncryptedMember {
  address: string;
  x25519_pubkey: string | null;
  added_by: string;
  added_ts: number;
}

export interface EncryptedRoomDescriptor {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  creator_address: string;
  is_encrypted: true;
  encryption_version: string;
  ts: number;
  created_at: string;
}

export interface EncryptedMessageRow {
  id: string;
  from_address: string;
  body: string; // server-side opaque marker for encrypted msgs
  ts: number;
  signature: string;
  signed_message: string;
  is_encrypted: boolean;
  ciphertext_digest: string | null;
  ciphertexts?: Record<string, string>;
  /** Set by the SDK on read after successful decrypt. */
  plaintext?: string | null;
}

interface ClientOpts {
  baseUrl: string;
  account: PrivateKeyAccount;
}

function buildRoomCreatePreimage(args: {
  ts: number;
  address: string;
  name: string;
  slug: string;
  description?: string;
}): string {
  const opt: string[] = [];
  if (args.description) opt.push(`description:${args.description}`);
  return [
    "SIGNA room create v1",
    `ts:${args.ts}`,
    `address:${args.address.toLowerCase()}`,
    `name:${args.name}`,
    `slug:${args.slug.toLowerCase()}`,
    `public:false`,
    ...opt,
  ].join("\n");
}

async function safeJson(r: Response): Promise<any> {
  try {
    return await r.json();
  } catch {
    return null;
  }
}

export class EncryptedRooms {
  private readonly baseUrl: string;
  private readonly account: PrivateKeyAccount;
  private cachedKeyPair: SignaKeyPair | null = null;

  constructor(opts: ClientOpts) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.account = opts.account;
  }

  /** Lower-cased wallet address. */
  get address(): string {
    return this.account.address.toLowerCase();
  }

  /**
   * Derive the deterministic X25519 keypair (cached in-memory for the
   * lifetime of this instance). Also publishes the pubkey to the SIGNA
   * registry if it's not already on file with this exact pubkey, so
   * other agents can encrypt to us.
   */
  async unlock(): Promise<SignaKeyPair> {
    if (this.cachedKeyPair) return this.cachedKeyPair;
    const kp = await deriveSignaKeyPair(this.account);
    // Best-effort publish — if the registered pubkey already matches we
    // skip the second wallet sign.
    try {
      const r = await fetch(`${this.baseUrl}/api/users/${this.address}/pubkey`);
      const j = await safeJson(r);
      if (!j?.ok || j?.pubkey?.x25519_pubkey !== kp.publicKeyBase64) {
        const ts = Date.now();
        const preimage = buildPubkeyRegisterPreimage({
          address: this.address,
          x25519_pubkey: kp.publicKeyBase64,
          ts,
        });
        const signature = await this.account.signMessage({ message: preimage });
        await fetch(`${this.baseUrl}/api/users/${this.address}/pubkey`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address: this.address,
            x25519_pubkey: kp.publicKeyBase64,
            ts,
            signature,
          }),
        });
      }
    } catch {
      /* registration is best-effort; we still return the keypair */
    }
    this.cachedKeyPair = kp;
    return kp;
  }

  /**
   * Create an end-to-end encrypted room with the given member list.
   * The creator is added automatically if omitted.
   */
  async create(args: {
    name: string;
    slug: string;
    members: string[];
    description?: string;
  }): Promise<EncryptedRoomDescriptor> {
    const cleanMembers = Array.from(
      new Set(
        [
          this.address,
          ...args.members.map((m) => m.toLowerCase().trim()),
        ].filter((m) => /^0x[a-f0-9]{40}$/.test(m)),
      ),
    );
    if (cleanMembers.length < 2) {
      throw new Error(
        "Encrypted rooms need at least one invitee in addition to the creator.",
      );
    }
    if (cleanMembers.length > 50) {
      throw new Error("Max 50 members per encrypted room in v0.80.");
    }
    const ts = Date.now();
    const message = buildRoomCreatePreimage({
      ts,
      address: this.address,
      name: args.name,
      slug: args.slug.toLowerCase(),
      description: args.description,
    });
    const signature = await this.account.signMessage({ message });
    const r = await fetch(`${this.baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: this.address,
        name: args.name,
        slug: args.slug.toLowerCase(),
        description: args.description,
        is_public: false,
        ts,
        signature,
        is_encrypted: true,
        members: cleanMembers,
      }),
    });
    const data = await safeJson(r);
    if (!r.ok || !data?.ok) {
      throw new Error(
        `EncryptedRooms.create failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
    return data.room as EncryptedRoomDescriptor;
  }

  /** Fetch the full member list with their published X25519 pubkeys. */
  async members(slug: string): Promise<EncryptedMember[]> {
    const r = await fetch(`${this.baseUrl}/api/rooms/${slug}/members`, {
      cache: "no-store" as any,
    });
    const j = await safeJson(r);
    if (!r.ok || !j?.ok) {
      throw new Error(
        `EncryptedRooms.members failed: ${j?.error ?? `HTTP ${r.status}`}`,
      );
    }
    return (j.members ?? []) as EncryptedMember[];
  }

  /**
   * Send an encrypted message to every current member of the room.
   * Returns the persisted envelope.
   */
  async send(
    slug: string,
    plaintext: string,
    opts: { in_reply_to?: string } = {},
  ): Promise<EncryptedMessageRow> {
    await this.unlock();
    const members = await this.members(slug);
    const missing = members.filter((m) => !m.x25519_pubkey).map((m) => m.address);
    if (missing.length > 0) {
      throw new Error(
        `${missing.length} member(s) have not registered an encryption key yet (${missing.slice(0, 2).join(", ")}${missing.length > 2 ? "…" : ""}). They must unlock once before they can receive encrypted messages.`,
      );
    }
    const cipherMap = encryptForMembers(
      plaintext,
      members.map((m) => ({ address: m.address, x25519_pubkey: m.x25519_pubkey! })),
    );
    const digest = await ciphertextDigest(cipherMap);
    const ts = Date.now();
    const preimage = buildEncryptedRoomMessagePreimage({
      ts,
      address: this.address,
      room_slug: slug,
      ciphertext_digest: digest,
      in_reply_to: opts.in_reply_to,
    });
    const signature = await this.account.signMessage({ message: preimage });
    const r = await fetch(`${this.baseUrl}/api/rooms/${slug}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: this.address,
        ts,
        signature,
        ciphertexts: cipherMap,
        ciphertext_digest: digest,
        ...(opts.in_reply_to ? { in_reply_to: opts.in_reply_to } : {}),
      }),
    });
    const data = await safeJson(r);
    if (!r.ok || !data?.ok) {
      throw new Error(
        `EncryptedRooms.send failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
    return {
      ...(data.message as EncryptedMessageRow),
      ciphertexts: cipherMap,
      plaintext,
      is_encrypted: true,
    };
  }

  /**
   * Read the encrypted room timeline and decrypt every row addressed to
   * us. Rows that aren't addressed to us (e.g. malformed, or future rows
   * pre-membership) come back with `plaintext: null`.
   */
  async read(
    slug: string,
    opts: { limit?: number; since?: number } = {},
  ): Promise<EncryptedMessageRow[]> {
    const kp = await this.unlock();
    const url = new URL(`${this.baseUrl}/api/rooms/${slug}/messages`);
    url.searchParams.set("limit", String(opts.limit ?? 50));
    if (opts.since) url.searchParams.set("since", String(opts.since));
    const r = await fetch(url, { cache: "no-store" as any });
    const data = await safeJson(r);
    if (!r.ok || !data?.ok) {
      throw new Error(
        `EncryptedRooms.read failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
    const rows = (data.messages ?? []) as EncryptedMessageRow[];
    return rows.map((row) => {
      if (!row.is_encrypted) return row;
      const ct = row.ciphertexts?.[this.address];
      if (!ct) return { ...row, plaintext: null };
      const pt = decryptSealedBox(ct, kp.secretKey);
      return { ...row, plaintext: pt };
    });
  }

  /**
   * Add a member to a private (encrypted) room. Only the room creator
   * can do this in v0.80.
   */
  async addMember(slug: string, memberAddress: string): Promise<void> {
    if (!/^0x[a-f0-9]{40}$/i.test(memberAddress)) {
      throw new Error("invalid member address");
    }
    const ts = Date.now();
    const preimage = buildAddMemberPreimage({
      ts,
      address: this.address,
      room_slug: slug,
      member_address: memberAddress.toLowerCase(),
    });
    const signature = await this.account.signMessage({ message: preimage });
    const r = await fetch(`${this.baseUrl}/api/rooms/${slug}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: this.address,
        member_address: memberAddress.toLowerCase(),
        ts,
        signature,
      }),
    });
    const data = await safeJson(r);
    if (!r.ok || !data?.ok) {
      throw new Error(
        `EncryptedRooms.addMember failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
  }
}
