/**
 * Token watchlist primitive — supports BOTH local-only mode (no wallet
 * connected) and synced mode (wallet connected → mirror to Supabase via
 * /api/me/watchlist).
 *
 * Local mode (legacy): just localStorage. Works instantly, no auth, no
 * roundtrip. State of the world before this commit.
 *
 * Synced mode (new): when a wallet is connected, callers pass the address
 * into add/remove which:
 *   1. updates localStorage immediately (optimistic UX)
 *   2. fires a wallet-signed POST to /api/me/watchlist in the background
 *   3. on reconnect/first-load, mergeFromServer() reconciles the local
 *      bookmarks with whatever the server has on file for the wallet
 *
 * Net: bookmarks follow you across devices once you've signed at least
 * once on each, but still work before XMTP/signature flow if you just
 * bookmark anonymously.
 */

import { buildMessageToSign } from "./feed-types";

const KEY = "signa:watchlist";

function safeRead(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.toLowerCase())
      .filter((s) => /^0x[a-f0-9]{40}$/.test(s));
  } catch {
    return [];
  }
}

function safeWrite(addresses: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(Array.from(new Set(addresses))));
  } catch {
    // localStorage full or blocked — ignore
  }
}

export function getWatchlist(): string[] {
  return safeRead();
}

export function isWatched(address: string): boolean {
  return safeRead().includes(address.toLowerCase());
}

/**
 * Add a token to the watchlist. Updates localStorage synchronously
 * and, if signMessage + walletAddress provided, fires an async signed
 * POST to /api/me/watchlist so it persists across devices.
 */
export async function addToWatchlist(
  tokenAddress: string,
  opts?: {
    walletAddress?: string;
    signMessage?: (args: { message: string }) => Promise<string>;
  },
): Promise<string[]> {
  const addr = tokenAddress.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return getWatchlist();

  // 1. Local first (instant UI)
  const list = safeRead();
  const next = list.includes(addr) ? list : [addr, ...list].slice(0, 100);
  safeWrite(next);

  // 2. Sync to server if we can sign
  if (opts?.walletAddress && opts?.signMessage) {
    void syncToggle(addr, "add", opts.walletAddress, opts.signMessage);
  }

  return next;
}

/**
 * Remove a token. Same dual-mode as add.
 */
export async function removeFromWatchlist(
  tokenAddress: string,
  opts?: {
    walletAddress?: string;
    signMessage?: (args: { message: string }) => Promise<string>;
  },
): Promise<string[]> {
  const addr = tokenAddress.toLowerCase();
  const next = safeRead().filter((a) => a !== addr);
  safeWrite(next);

  if (opts?.walletAddress && opts?.signMessage) {
    void syncToggle(addr, "remove", opts.walletAddress, opts.signMessage);
  }

  return next;
}

/**
 * Fetch the server-side watchlist for a wallet and merge it into the
 * local list. Call once when a wallet first connects so previously-
 * signed bookmarks reappear on new devices.
 */
export async function mergeFromServer(walletAddress: string): Promise<string[]> {
  try {
    const res = await fetch(
      `/api/me/watchlist?address=${walletAddress.toLowerCase()}`,
      { cache: "no-store" },
    );
    if (!res.ok) return safeRead();
    const j: { ok: true; watchlist: string[] } = await res.json();
    const remote = (j.watchlist ?? [])
      .map((s) => s.toLowerCase())
      .filter((s) => /^0x[a-f0-9]{40}$/.test(s));
    const merged = Array.from(new Set([...remote, ...safeRead()])).slice(0, 100);
    safeWrite(merged);
    return merged;
  } catch {
    return safeRead();
  }
}

async function syncToggle(
  tokenAddress: string,
  op: "add" | "remove",
  walletAddress: string,
  signMessage: (args: { message: string }) => Promise<string>,
): Promise<void> {
  try {
    const ts = Date.now();
    const message = buildMessageToSign({
      kind: "watchlist_toggle",
      address: walletAddress.toLowerCase(),
      token_address: tokenAddress.toLowerCase(),
      op,
      ts,
    });
    const signature = await signMessage({ message });
    await fetch("/api/me/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: walletAddress.toLowerCase(),
        token_address: tokenAddress.toLowerCase(),
        op,
        ts,
        signature,
      }),
    });
  } catch {
    // best-effort — local copy is still right
  }
}
