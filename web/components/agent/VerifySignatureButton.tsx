"use client";

import { useState } from "react";
import { verifyMessage } from "viem";

/**
 * One-click signature verifier for a quoted agent reply.
 *
 * Runs viem.verifyMessage(address, message, signature) in the browser.
 * No wallet needed — pure cryptographic check. Works for both EOA and
 * EIP-1271 (smart-account) signatures. Renders inline as a small text
 * button that flips to ✓ verified / ✗ invalid after a click.
 *
 * Why client-side: anyone reading the permalink can verify with their
 * own RPC if they're paranoid about a compromised SIGNA server. The
 * proof is self-contained.
 */
export function VerifySignatureButton({
  address,
  message,
  signature,
}: {
  address: string;
  message: string;
  signature: string;
}) {
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "bad">(
    "idle",
  );
  const [err, setErr] = useState<string | null>(null);

  async function check() {
    setStatus("checking");
    setErr(null);
    try {
      const ok = await verifyMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
      setStatus(ok ? "ok" : "bad");
    } catch (e) {
      setStatus("bad");
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (status === "ok") {
    return (
      <span className="text-emerald-300">[ ✓ signature verified ]</span>
    );
  }
  if (status === "bad") {
    return (
      <span className="text-red-300" title={err ?? ""}>
        [ ✗ signature invalid ]
      </span>
    );
  }
  return (
    <button
      onClick={check}
      disabled={status === "checking"}
      className="text-[var(--accent)] hover:underline underline-offset-4 disabled:opacity-40"
    >
      {status === "checking" ? "[ verifying… ]" : "[ verify signature ]"}
    </button>
  );
}
