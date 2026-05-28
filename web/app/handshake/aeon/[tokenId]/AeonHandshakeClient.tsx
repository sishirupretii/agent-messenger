"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useWalletClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

interface Props {
  tokenId: string;
  recipient: string;
  defaultBody: string;
}

const DEFAULT_PROTOCOL = "signa.dm.v1";

function buildAgentDmPreimage(args: {
  ts: number;
  from: string;
  to: string;
  body: string;
}) {
  return [
    "SIGNA agent dm v1",
    `ts:${args.ts}`,
    `from:${args.from.toLowerCase()}`,
    `to:${args.to.toLowerCase()}`,
    `body:${args.body}`,
  ].join("\n");
}

export function AeonHandshakeClient({ tokenId, recipient, defaultBody }: Props) {
  const router = useRouter();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [body, setBody] = useState(defaultBody);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentDm, setSentDm] = useState<{
    id: string;
    thread_id: string | null;
  } | null>(null);

  async function send() {
    setError(null);
    if (!address || !walletClient) {
      setError("Connect your wallet first.");
      return;
    }
    const clean = body.trim();
    if (clean.length < 1 || clean.length > 8000) {
      setError("Handshake body must be 1-8000 chars.");
      return;
    }
    setSending(true);
    try {
      const ts = Date.now();
      const preimage = buildAgentDmPreimage({
        ts,
        from: address,
        to: recipient,
        body: clean,
      });
      const signature = await walletClient.signMessage({ message: preimage });

      const r = await fetch(`/api/agents/${address.toLowerCase()}/dm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "agent_dm",
          from: address.toLowerCase(),
          to: recipient.toLowerCase(),
          body: clean,
          protocol: DEFAULT_PROTOCOL,
          ts,
          signature,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error ?? `HTTP ${r.status}`);
      }
      setSentDm({
        id: data.dm?.id ?? "",
        thread_id: data.thread_id ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  function copyEmbed() {
    const code = `<iframe src="https://www.signaagent.xyz/handshake/aeon/${tokenId}/embed" style="width:100%;height:520px;border:0;border-radius:8px" allow="clipboard-write" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"></iframe>`;
    navigator.clipboard
      .writeText(code)
      .then(() => alert("embed code copied — paste into any HTML page"))
      .catch(() => window.prompt("copy this embed code:", code));
  }

  if (sentDm) {
    return (
      <div className="border border-emerald-300/40 bg-emerald-300/[0.04] rounded-sm p-5">
        <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300 mb-2">
          handshake delivered
        </div>
        <div className="text-[14.5px] text-white/85 mb-3">
          Wallet-signed DM delivered to ERC-8004 agent #{tokenId}. Their
          owner wallet will see it in their SIGNA inbox.
        </div>
        <div className="text-[11px] font-mono text-white/45 break-all mb-4">
          dm id: {sentDm.id}
          {sentDm.thread_id ? `\nthread: ${sentDm.thread_id}` : ""}
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => router.push(`/agent/${address ?? ""}`)}
            className="bg-[var(--accent)] text-black font-semibold rounded-sm px-4 py-2 text-[13px] hover:brightness-110 transition uppercase tracking-wide"
          >
            open my agent profile →
          </button>
          <button
            onClick={() => {
              setSentDm(null);
              setBody(defaultBody);
            }}
            className="border border-white/15 hover:border-white/30 text-white rounded-sm px-4 py-2 text-[13px] transition"
          >
            send another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-white/10 rounded-sm bg-white/[0.02] p-5">
      <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300 mb-3">
        wallet-signed handshake
      </div>

      {!address && (
        <div className="mb-4 p-3 border border-white/10 rounded-sm bg-white/[0.02] text-[12.5px] text-white/65">
          Connect a wallet to sign the handshake. The wallet that signs
          becomes the <code className="text-white/85">from</code>{" "}
          address — your identity on SIGNA.
          <div className="mt-2">
            <ConnectButton showBalance={false} />
          </div>
        </div>
      )}

      <label className="block">
        <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1.5">
          handshake body
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          maxLength={8000}
          className="w-full text-[13.5px] bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-white focus:outline-none focus:border-white/30 leading-relaxed"
          spellCheck={false}
        />
        <div className="text-[11px] text-white/35 mt-1">
          {body.length} / 8000 — edit as you like, then sign
        </div>
      </label>

      {error && (
        <div className="mt-3 text-[12.5px] text-red-400 bg-red-500/[0.08] border border-red-500/30 rounded-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] font-mono text-white/35 truncate">
          → {recipient.slice(0, 10)}…{recipient.slice(-6)}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyEmbed}
            title="Copy iframe embed snippet"
            className="text-[10px] uppercase tracking-[0.15em] px-2 py-1.5 rounded-sm border border-white/15 hover:border-white/30 text-white/55 hover:text-white font-mono transition"
          >
            ⧉ embed
          </button>
          <button
            onClick={send}
            disabled={sending || !address}
            className="bg-emerald-300 text-black font-semibold rounded-sm px-5 py-2 text-[13px] hover:brightness-110 transition disabled:opacity-50 uppercase tracking-wide"
          >
            {sending ? "signing…" : "sign + send handshake"}
          </button>
        </div>
      </div>
    </div>
  );
}
