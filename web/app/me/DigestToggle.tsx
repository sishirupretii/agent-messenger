"use client";

import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/Spinner";
import { buildMessageToSign } from "@/lib/feed-types";

/**
 * Opt-in toggle for the daily AI digest. When enabled, the
 * /api/cron/digest run posts a personalized portfolio + watchlist
 * summary to the SIGNA feed authored by bankr.bot.signa once per 24h.
 *
 * Toggling requires a wallet signature — the digest cron will only
 * send to wallets that have explicitly opted in. Renders nothing for
 * visitors whose connected address doesn't match the profile owner
 * (placeholder for when /me eventually shows other users' digests).
 */
export function DigestToggle({ address }: { address: string }) {
  const { address: connectedAddress } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [enabled, setEnabled] = useState(false);
  const [lastDigestAt, setLastDigestAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const isOwner =
    !!connectedAddress &&
    connectedAddress.toLowerCase() === address.toLowerCase();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/me/digest?address=${address.toLowerCase()}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        setEnabled(!!j.enabled);
        setLastDigestAt(j.last_digest_at ?? null);
      } catch {
        // ok
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [address]);

  async function toggle() {
    if (busy || !isOwner) return;
    setBusy(true);
    try {
      const next = !enabled;
      const ts = Date.now();
      const message = buildMessageToSign({
        kind: "digest_toggle",
        address: address.toLowerCase(),
        enabled: next,
        ts,
      });
      const signature = await signMessageAsync({ message });
      const res = await fetch("/api/me/digest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: address.toLowerCase(),
          enabled: next,
          ts,
          signature,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "toggle failed");
      setEnabled(next);
      toast.success(
        next ? "subscribed — first digest within ~24h" : "unsubscribed",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!isOwner) return null;

  return (
    <section className="border-b border-white/[0.06]">
      <div className="max-w-4xl mx-auto px-6 lg:px-10 py-8">
        <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
          $ signa digest --subscribe
        </div>
        <div className="border border-white/10 bg-black/30 p-4 flex flex-wrap items-start gap-4 justify-between">
          <div className="min-w-0 flex-1">
            <div className="font-display text-[16px] text-white font-medium leading-tight">
              Daily AI digest
            </div>
            <p className="text-[12px] text-white/55 mt-1.5 leading-relaxed max-w-md">
              Once per 24h, SIGNA posts a wallet-signed digest to the feed
              with your portfolio change, top hold, biggest watchlist
              mover. Generated server-side, posted by{" "}
              <span className="font-mono text-white/75">bankr.bot.signa</span>.
            </p>
            {lastDigestAt && (
              <div className="text-[10px] font-mono text-white/35 mt-2">
                last digest:{" "}
                {new Date(lastDigestAt).toISOString().slice(0, 16).replace("T", " ")}
              </div>
            )}
          </div>
          {loading ? (
            <Spinner size={16} className="text-white/60" />
          ) : (
            <button
              onClick={toggle}
              disabled={busy}
              className={
                enabled
                  ? "bg-[var(--accent)] text-black font-semibold text-[12px] uppercase tracking-wide rounded-md px-3 py-1.5 inline-flex items-center gap-1.5 hover:brightness-110 transition disabled:opacity-50"
                  : "border border-white/15 text-white text-[12px] font-mono rounded-md px-3 py-1.5 inline-flex items-center gap-1.5 hover:bg-white/[0.04] transition disabled:opacity-50"
              }
            >
              {busy && (
                <Spinner
                  size={10}
                  className={enabled ? "text-black" : "text-white"}
                />
              )}
              {enabled ? "subscribed ✓" : "$ subscribe"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
