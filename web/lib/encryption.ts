/**
 * v0.80 — SIGNA encrypted-room client crypto.
 *
 * Wire scheme: signa-sealedbox-v1
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ ephemeral_pub (32) │ nonce (24) │ ciphertext+poly1305 mac (..)│
 *   └───────────────────────────────────────────────────────────────┘
 *
 * For each plaintext + recipient pubkey:
 *   1. ephemeral_kp = nacl.box.keyPair()
 *   2. nonce        = nacl.randomBytes(24)
 *   3. ct           = nacl.box(plaintext, nonce, recipient_pub, ephemeral_priv)
 *   4. envelope     = ephemeral_pub || nonce || ct
 *   5. base64       = btoa(envelope)
 *
 * Decrypt:
 *   1. bytes        = atob(base64)
 *   2. epk, nonce, ct = bytes[0..32], bytes[32..56], bytes[56..]
 *   3. plaintext    = nacl.box.open(ct, nonce, epk, my_secret_key)
 *
 * X25519 keypair is deterministic per wallet — derived from the EIP-191
 * signature over the fixed preimage `X25519_DERIVE_PREIMAGE`. Same wallet
 * on any device produces the same X25519 keypair. The server never sees
 * the secret key.
 */
import nacl from "tweetnacl";
import { X25519_DERIVE_PREIMAGE } from "./feed-types";

export const SEALEDBOX_VERSION = "signa-sealedbox-v1";

// ───────── base64 helpers (browser- and node-safe) ─────────

function bytesToBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  if (typeof btoa !== "undefined") return btoa(s);
  return Buffer.from(s, "binary").toString("base64");
}

function base64ToBytes(s: string): Uint8Array {
  const bin =
    typeof atob !== "undefined" ? atob(s) : Buffer.from(s, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function sha256(b: Uint8Array): Promise<Uint8Array> {
  // Slice into a fresh ArrayBuffer so TS doesn't complain about
  // ArrayBufferLike vs ArrayBuffer on Node 20's lib.dom types.
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const h = await crypto.subtle.digest("SHA-256", ab);
  return new Uint8Array(h);
}

// ───────── keypair derivation ─────────

export type SignaKeyPair = {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyBase64: string;
};

/**
 * Derive a deterministic X25519 keypair from a wallet by signing the
 * fixed preimage `X25519_DERIVE_PREIMAGE` via EIP-191 personal_sign.
 *
 * The 65-byte signature (r, s, v) is hashed with sha256 to produce a
 * 32-byte seed for the X25519 secret key. Same wallet = same keypair
 * on every device, no extra storage needed.
 */
export async function deriveSignaKeyPair(
  signFn: (message: string) => Promise<`0x${string}` | string>,
): Promise<SignaKeyPair> {
  const sigHex = await signFn(X25519_DERIVE_PREIMAGE);
  const sigBytes = hexToBytes(sigHex);
  const seed = await sha256(sigBytes);
  const kp = nacl.box.keyPair.fromSecretKey(seed);
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    publicKeyBase64: bytesToBase64(kp.publicKey),
  };
}

// ───────── sealed-box per recipient ─────────

/**
 * Encrypt a UTF-8 plaintext to a single recipient's X25519 public key.
 * Returns base64(ephemeral_pub || nonce || box_ciphertext).
 */
export function encryptSealedBox(
  plaintext: string,
  recipientPublicKeyBase64: string,
): string {
  const recipientPub = base64ToBytes(recipientPublicKeyBase64);
  if (recipientPub.length !== 32) {
    throw new Error("recipient pubkey must be 32 bytes");
  }
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const msgBytes = new TextEncoder().encode(plaintext);
  const ct = nacl.box(msgBytes, nonce, recipientPub, ephemeral.secretKey);
  const envelope = new Uint8Array(32 + 24 + ct.length);
  envelope.set(ephemeral.publicKey, 0);
  envelope.set(nonce, 32);
  envelope.set(ct, 56);
  return bytesToBase64(envelope);
}

/**
 * Decrypt a sealed-box back to its UTF-8 plaintext using this wallet's
 * derived secret key. Returns null when the ciphertext is malformed or
 * the secret key doesn't match.
 */
export function decryptSealedBox(
  ciphertextBase64: string,
  mySecretKey: Uint8Array,
): string | null {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(ciphertextBase64);
  } catch {
    return null;
  }
  if (bytes.length < 56 + 16) return null;
  const ephemeralPub = bytes.slice(0, 32);
  const nonce = bytes.slice(32, 56);
  const ct = bytes.slice(56);
  const opened = nacl.box.open(ct, nonce, ephemeralPub, mySecretKey);
  if (!opened) return null;
  try {
    return new TextDecoder().decode(opened);
  } catch {
    return null;
  }
}

/**
 * Encrypt a plaintext to every recipient in the membership list,
 * returning a `{address_lower: ciphertext_base64}` map ready to POST
 * to /api/rooms/[slug]/messages.
 */
export function encryptForMembers(
  plaintext: string,
  members: Array<{ address: string; x25519_pubkey: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of members) {
    out[m.address.toLowerCase()] = encryptSealedBox(plaintext, m.x25519_pubkey);
  }
  return out;
}
