import crypto from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Constant-time comparison for shared-secret Bearer tokens.
 *
 * Plain `header === "Bearer <secret>"` leaks the secret byte-by-byte
 * to a remote attacker who can time the response. crypto.timingSafeEqual
 * compares the full buffers in constant time regardless of where the
 * mismatch falls.
 *
 * Use everywhere we authenticate a service-to-service call via a
 * shared secret — Vercel crons, the Railway runtime fetch, partner
 * webhooks. Wallet-signature flows go through verifySignedMessage
 * which is already constant-time inside viem.
 */
export function authorizeBearer(req: NextRequest, envName: string): boolean {
  const secret = process.env[envName];
  if (!secret) return false;

  // 1) Authorization: Bearer <secret>
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) {
    const given = header.slice("Bearer ".length);
    if (constantTimeStringEqual(given, secret)) return true;
  }

  // 2) ?key=<secret> — accepted for Vercel cron probes that can't set
  // a header. Same constant-time compare.
  const key = req.nextUrl.searchParams.get("key");
  if (key && constantTimeStringEqual(key, secret)) return true;

  return false;
}

/**
 * Constant-time UTF-8 string compare. Pads the shorter buffer to the
 * longer's length so length-based timing differences also leak nothing.
 *
 * Returns false for any non-string input or empty secret.
 */
export function constantTimeStringEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || b.length === 0) return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // Pad whichever buffer is shorter so timingSafeEqual doesn't throw.
  // The length comparison happens AFTER the constant-time byte compare.
  const len = Math.max(ab.length, bb.length);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  ab.copy(padA);
  bb.copy(padB);
  const equalBytes = crypto.timingSafeEqual(padA, padB);
  return equalBytes && ab.length === bb.length;
}
