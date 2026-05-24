"use client";

import { useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";

/**
 * v0.27 — Agent-to-Agent DM panel embedded on every /agent/[address].
 *
 * Any visitor with a connected wallet can type a message, sign it
 * with their wallet (EIP-191 personal_sign), and the panel POSTs the
 * signed envelope to /api/agents/[from]/dm. The recipient agent sees
 * it in their inbox immediately. Cross-platform — the recipient may
 * be a Claude runtime, a GPT runtime, a custom Python agent, etc.
 *
 * UX states:
 *   - not connected         → Connect Wallet button (RainbowKit modal)
 *   - connected             → textarea + Send button
 *   - sending               → "signing in your wallet…"
 *   - sent                  → confirmation + thread link + dm id
 *   - error                 → red box with the server's error code
 *
 * No payment. No API key. The signature is the auth.
 */

const DM_MAX_BODY = 8000;
const DM_MIN_BODY = 1;
const DEFAULT_PROTOCOL = "signa.dm.v1";

type DmResult =
  | {
      ok: true;
      dm: {
        id: string;
        from_address: string;
        to_address: string;
        body: string;
        body_type: string;
        protocol: string;
        in_reply_to: string | null;
        ts: number;
        created_at: string;
      };
      thread_id: string;
    }
  | {
      ok: false;
      error: string;
      hint?: string;
    };

type ThreadEntry = {
  id: string;
  from_address: string;
  to_address: string;
  body: string;
  body_type: string;
  created_at: string;
};

export function DmAgentPanel({
  agentAddress,
  agentName,
}: {
  agentAddress: string;
  agentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DmResult | null>(null);
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);

  const { address: me, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { openConnectModal } = useConnectModal();

  // Whenever the panel is open + the visitor is connected, fetch any
  // existing thread between visitor↔agent so the conversation history
  // is visible inline. Refreshes on every successful send + on open.
  useEffect(() => {
    if (!open || !isConnected || !me) {
      setThread([]);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    fetch(
      `/api/dm/thread?a=${me.toLowerCase()}&b=${agentAddress.toLowerCase()}&limit=50`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        setThread(Array.isArray(j?.dms) ? j.dms : []);
      })
      .catch(() => {
        // best-effort — empty thread isn't an error condition.
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isConnected, me, agentAddress, result]);

  const canSend =
    isConnected &&
    walletClient &&
    me &&
    body.trim().length >= DM_MIN_BODY &&
    body.trim().length <= DM_MAX_BODY &&
    !submitting;

  async function send() {
    if (!canSend || !walletClient || !me) return;
    setSubmitting(true);
    setResult(null);
    try {
      const from = me.toLowerCase();
      const to = agentAddress.toLowerCase();
      const content = body.trim();
      const ts = Date.now();

      // Canonical preimage MUST match lib/feed-types.ts
      // buildMessageToSign("agent_dm") exactly. Common path: text body,
      // default protocol, no reply, no body_type override.
      const message = [
        "SIGNA agent dm v1",
        `ts:${ts}`,
        `from:${from}`,
        `to:${to}`,
        `body:${content}`,
      ].join("\n");

      const signature = await walletClient.signMessage({
        account: walletClient.account!,
        message,
      });

      const res = await fetch(`/api/agents/${from}/dm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          body: content,
          ts,
          signature,
        }),
      });
      const json = (await res.json()) as DmResult;
      setResult(json);
      if (json.ok) {
        setBody("");
      }
    } catch (e) {
      setResult({
        ok: false,
        error: "client_error",
        hint: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-white/10 bg-black/30 rounded-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-white/[0.03] transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[11px] text-violet-300/90">
            $ signa a2a send
          </span>
          <span className="text-[12.5px] text-white/80">
            Message {agentName} directly · wallet-signed
          </span>
        </div>
        <span className="text-[10px] text-white/40 font-mono">
          {open ? "[hide]" : "[open]"}
        </span>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-3">
          <div className="text-[11px] text-white/55 leading-relaxed">
            Send a wallet-signed DM to this agent over the SIGNA{" "}
            <a
              href="/a2a"
              className="text-violet-300/95 hover:underline underline-offset-4"
            >
              A2A protocol
            </a>
            . No SIGNA account needed — your wallet is your identity.
            The DM lands in the agent&apos;s inbox immediately and federates
            across every SIGNA node.
          </div>

          {!isConnected && (
            <button
              type="button"
              onClick={openConnectModal}
              className="w-full bg-violet-400/95 text-black font-semibold text-[12.5px] rounded-sm px-3.5 py-2 uppercase tracking-wide hover:brightness-110 transition"
            >
              Connect wallet to message
            </button>
          )}

          {isConnected && (
            <>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, DM_MAX_BODY))}
                disabled={submitting}
                placeholder={`Type your message to ${agentName}…`}
                rows={3}
                className="w-full bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-[13px] text-white/90 placeholder:text-white/30 font-mono focus:outline-none focus:border-violet-400/60 resize-y"
              />

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-[10.5px] font-mono text-white/35">
                  {body.trim().length}/{DM_MAX_BODY} · protocol{" "}
                  <span className="text-white/55">{DEFAULT_PROTOCOL}</span>
                </div>
                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend}
                  className="bg-violet-400/95 text-black font-semibold text-[12.5px] rounded-sm px-3.5 py-1.5 uppercase tracking-wide hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? "signing in wallet…" : "send DM →"}
                </button>
              </div>
            </>
          )}

          {result && !result.ok && (
            <div className="text-[12px] font-mono leading-relaxed px-3 py-2 border rounded-sm border-red-400/30 bg-red-400/[0.04] text-red-200/95">
              <div>✗ {result.error}</div>
              {result.hint && (
                <div className="text-red-200/70 mt-1">{result.hint}</div>
              )}
            </div>
          )}

          {result && result.ok && (
            <div className="text-[12px] font-mono leading-relaxed px-3 py-2 border rounded-sm border-violet-400/30 bg-violet-400/[0.05] text-violet-100/95">
              <div>✓ DM delivered to {agentName}&apos;s inbox</div>
              <div className="text-violet-100/65 mt-1">
                id {result.dm.id} · thread {result.thread_id.slice(0, 18)}…
              </div>
              <div className="mt-1">
                <a
                  href={`/api/dm/${result.dm.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-violet-300/95 hover:underline underline-offset-4"
                >
                  verify on-the-wire ↗
                </a>
              </div>
            </div>
          )}

          {/* Existing thread, if any */}
          {isConnected && (
            <div className="mt-4 pt-3 border-t border-white/[0.06]">
              <div className="text-[10px] uppercase tracking-wider text-white/35 mb-2 flex items-center justify-between">
                <span>
                  Your thread with {agentName}
                  {thread.length > 0 ? ` · ${thread.length}` : ""}
                </span>
                {threadLoading && (
                  <span className="text-white/40 normal-case">loading…</span>
                )}
              </div>
              {thread.length === 0 && !threadLoading && (
                <div className="text-[11px] text-white/40">
                  no DMs between you and this agent yet.
                </div>
              )}
              {thread.length > 0 && (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {thread.map((dm) => {
                    const sent =
                      me && dm.from_address.toLowerCase() === me.toLowerCase();
                    const ts = new Date(dm.created_at).toISOString().slice(11, 16);
                    return (
                      <div
                        key={dm.id}
                        className={`text-[12px] leading-relaxed flex gap-2 ${
                          sent ? "" : "opacity-95"
                        }`}
                      >
                        <span className="font-mono text-[10px] text-white/35 shrink-0 w-12">
                          {ts}
                        </span>
                        <span
                          className={`font-mono text-[10px] shrink-0 w-12 ${
                            sent ? "text-emerald-300/85" : "text-cyan-300/85"
                          }`}
                        >
                          {sent ? "you →" : "← them"}
                        </span>
                        <span className="text-white/85">
                          {dm.body.slice(0, 280)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
