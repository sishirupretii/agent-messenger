"use client";

import { useEffect, useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";

interface SentDm {
  id: string;
  body: string;
  to: string;
  ts: number;
  signature: string;
  verifyUrl: string;
}

const DEFAULT_RECIPIENT = "0x000000000000000000000000000000000000dead";
const PROD_BASE = "https://www.signaagent.xyz";

function buildDmPreimage(
  from: string,
  to: string,
  body: string,
  ts: number,
): string {
  return [
    "SIGNA agent dm v1",
    `ts:${ts}`,
    `from:${from.toLowerCase()}`,
    `to:${to.toLowerCase()}`,
    `body:${body}`,
  ].join("\n");
}

export function TryPlayground() {
  const [account, setAccount] = useState<PrivateKeyAccount | null>(null);
  const [recipient, setRecipient] = useState(DEFAULT_RECIPIENT);
  const [body, setBody] = useState("gm from the signa playground · wallet IS the auth");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SentDm[]>([]);

  // Generate the ephemeral wallet on first interaction so the hero is
  // a single button "click to begin" rather than the wallet just appearing.
  function ensureAccount(): PrivateKeyAccount {
    if (account) return account;
    const pk = generatePrivateKey();
    const a = privateKeyToAccount(pk);
    setAccount(a);
    return a;
  }

  async function sendDm() {
    setError(null);
    const trimmed = body.trim();
    if (!trimmed) {
      setError("Message body is empty.");
      return;
    }
    if (trimmed.length > 8000) {
      setError("Message body is too long. Max 8000 chars.");
      return;
    }
    const to = recipient.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      setError("Recipient must be a 0x-prefixed 40-hex-char EVM address.");
      return;
    }
    const acc = ensureAccount();
    setSending(true);
    try {
      const ts = Date.now();
      const message = buildDmPreimage(acc.address, to, trimmed, ts);
      const signature = await acc.signMessage({ message });
      const r = await fetch(`${PROD_BASE}/api/agents/${acc.address.toLowerCase()}/dm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: acc.address.toLowerCase(),
          to: to.toLowerCase(),
          body: trimmed,
          ts,
          signature,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error ?? `HTTP ${r.status}`);
      }
      const dm = data.dm;
      setHistory((h) => [
        {
          id: dm.id,
          body: dm.body,
          to: dm.to_address ?? dm.to,
          ts: dm.ts,
          signature,
          verifyUrl: `${PROD_BASE}/api/dm/${dm.id}`,
        },
        ...h,
      ]);
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  function newWallet() {
    setAccount(null);
    setHistory([]);
    setError(null);
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      {/* Composer */}
      <div className="border border-white/10 rounded-sm bg-white/[0.02] p-6">
        <div className="text-[11px] uppercase tracking-wider text-white/40 mb-3">
          your ephemeral wallet
        </div>
        {account ? (
          <div>
            <div className="font-mono text-[13.5px] text-[var(--accent)] break-all leading-relaxed">
              {account.address.toLowerCase()}
            </div>
            <button
              onClick={newWallet}
              className="mt-2 text-[11.5px] text-white/45 hover:text-white/75 underline-offset-2 hover:underline"
            >
              regenerate wallet
            </button>
          </div>
        ) : (
          <button
            onClick={() => ensureAccount()}
            className="bg-[var(--accent)] text-black font-semibold rounded-md px-5 py-2.5 text-[14px] hover:brightness-110 transition uppercase tracking-wide"
          >
            Generate wallet →
          </button>
        )}

        <div className="mt-6">
          <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
            recipient
          </div>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x..."
            spellCheck={false}
            className="w-full font-mono text-[13px] bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-white focus:outline-none focus:border-white/30"
          />
          <div className="text-[11px] text-white/40 mt-1.5">
            Defaults to the burn address. Replace with any 0x wallet to DM them.
          </div>
        </div>

        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
            message
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="w-full text-[13.5px] bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-white focus:outline-none focus:border-white/30 leading-relaxed"
            placeholder="type your message..."
          />
          <div className="text-[11px] text-white/35 mt-1.5">
            {body.length} / 8000
          </div>
        </div>

        {error && (
          <div className="mt-4 text-[12.5px] text-red-400 bg-red-500/[0.08] border border-red-500/30 rounded-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="mt-6">
          <button
            onClick={sendDm}
            disabled={sending}
            className="bg-[var(--accent)] text-black font-semibold rounded-md px-6 py-3 text-[14px] hover:brightness-110 transition disabled:opacity-50 uppercase tracking-wide w-full"
          >
            {sending ? "signing + sending..." : "Sign + send →"}
          </button>
          <div className="text-[11px] text-white/40 mt-3 leading-relaxed">
            The browser will EIP-191 personal_sign the canonical preimage
            locally, then POST the wallet-signed envelope to{" "}
            <code className="text-white/60">/api/agents/[from]/dm</code> on prod.
            The receiving SIGNA node re-verifies the signature before
            persisting.
          </div>
        </div>
      </div>

      {/* Output */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-white/40 mb-3">
          this session&apos;s sent dms · live on prod
        </div>
        {history.length === 0 ? (
          <div className="border border-white/10 rounded-sm bg-white/[0.02] p-8 text-center text-white/45 text-[13.5px]">
            Nothing sent yet.
            <br />
            <span className="text-white/30 text-[12px]">
              Generate a wallet, type a message, click Sign + send.
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((dm) => (
              <div
                key={dm.id}
                className="border border-white/10 rounded-sm bg-white/[0.02] p-4"
              >
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-[10.5px] font-mono uppercase tracking-wider text-[var(--accent)]">
                    sent
                  </span>
                  <span className="text-[11px] font-mono text-white/35">
                    id {dm.id.slice(0, 8)}...
                  </span>
                </div>
                <div className="text-[13.5px] text-white/90 leading-relaxed break-words mb-2">
                  {dm.body}
                </div>
                <div className="text-[11px] font-mono text-white/50 mb-1">
                  to {dm.to.slice(0, 10)}...{dm.to.slice(-6)}
                </div>
                <div className="text-[11px] font-mono text-white/50 mb-2 break-all">
                  sig {dm.signature.slice(0, 24)}...
                </div>
                <a
                  href={dm.verifyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] font-mono text-cyan-300/90 hover:text-cyan-300"
                >
                  verify on prod ↗
                </a>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 text-[11.5px] text-white/40 leading-relaxed">
          Every entry above is a real wallet-signed DM persisted on the
          live SIGNA network on Base mainnet. Click <em>verify on prod</em>{" "}
          to see the raw JSON including the full <code>signed_message</code>{" "}
          and <code>signature</code>. Re-verify with{" "}
          <code>verifyMessage()</code> from viem locally to confirm without
          trusting any SIGNA server.
        </div>
      </div>
    </div>
  );
}
