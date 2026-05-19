"use client";

import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { toast } from "sonner";

/**
 * Compact inline control letting the agent's launcher set or clear the
 * x402 per-call price on the /respond endpoint. Wallet-signed PATCH to
 * /api/agents/[addr]/x402 — server verifies launched_by ownership.
 *
 * No big chip-buttons or modal. Just a small `set price` row with an
 * input + a [save] / [clear] link. Matches the /me page aesthetic.
 */
export function X402PriceControl({
  agentAddress,
}: {
  agentAddress: string;
}) {
  const { address: connected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/${agentAddress.toLowerCase()}/x402`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        if (j?.ok && j.pricing?.price != null) {
          setCurrent(Number(j.pricing.price));
          setDraft(String(j.pricing.price));
        } else {
          setCurrent(null);
          setDraft("");
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentAddress]);

  async function save(nextPrice: number) {
    if (!connected) {
      toast.error("connect your wallet first");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const ts = Date.now();
      const payTo = agentAddress.toLowerCase();
      const message = [
        "SIGNA x402 set v1",
        `ts:${ts}`,
        `address:${agentAddress.toLowerCase()}`,
        `price_usdc:${nextPrice}`,
        `pay_to:${payTo}`,
        `currency:USDC`,
        `chain:base`,
      ].join("\n");
      const signature = await signMessageAsync({ message });
      const res = await fetch(
        `/api/agents/${agentAddress.toLowerCase()}/x402`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            price_usdc: nextPrice,
            pay_to: payTo,
            currency: "USDC",
            chain: "base",
            ts,
            signature,
          }),
        },
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "save failed");
      setCurrent(nextPrice > 0 ? nextPrice : null);
      toast.success(
        nextPrice > 0
          ? `x402 price set to ${nextPrice} USDC/call`
          : "x402 pricing cleared",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="text-white/35 text-[11px]">
        # loading x402 pricing…
      </div>
    );
  }

  return (
    <div className="font-mono text-[12px] text-white/65">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-white/35">x402:</span>
        <span className="text-white">
          {current != null ? `${current} USDC/call` : "free"}
        </span>
        <span className="text-white/30">·</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          max={1000}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="0.00"
          className="bg-transparent border-b border-white/15 focus:border-[var(--accent)] outline-none text-white px-1 py-0.5 w-[80px] text-[12px]"
        />
        <button
          disabled={busy}
          onClick={() => {
            const v = Number(draft);
            if (Number.isFinite(v) && v >= 0) void save(v);
          }}
          className="text-[var(--accent)] hover:underline underline-offset-4 disabled:opacity-40"
        >
          [ save ]
        </button>
        {current != null && (
          <button
            disabled={busy}
            onClick={() => {
              setDraft("0");
              void save(0);
            }}
            className="text-white/45 hover:text-white"
          >
            [ clear ]
          </button>
        )}
      </div>
      <div className="text-white/30 text-[10px] mt-0.5">
        # USDC on base · pay-to = agent address · honor-system v1
      </div>
    </div>
  );
}
