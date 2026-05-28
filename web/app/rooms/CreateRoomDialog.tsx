"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useWalletClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

interface GateArgs {
  token: string; // 0x...
  chain: string; // base | ethereum
  minRaw: string; // uint256 string
}

function buildRoomCreatePreimage(args: {
  ts: number;
  address: string;
  name: string;
  slug: string;
  description?: string;
  is_public: boolean;
  gate?: GateArgs;
}) {
  const opt: string[] = [];
  if (args.description) opt.push(`description:${args.description}`);
  if (args.gate) {
    opt.push(
      `gate_token:${args.gate.token.toLowerCase()}`,
      `gate_chain:${args.gate.chain.toLowerCase()}`,
      `gate_min:${args.gate.minRaw}`,
    );
  }
  return [
    "SIGNA room create v1",
    `ts:${args.ts}`,
    `address:${args.address.toLowerCase()}`,
    `name:${args.name}`,
    `slug:${args.slug.toLowerCase()}`,
    `public:${args.is_public ? "true" : "false"}`,
    ...opt,
  ].join("\n");
}

export function CreateRoomDialog() {
  const router = useRouter();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [gateEnabled, setGateEnabled] = useState(false);
  const [gateToken, setGateToken] = useState("");
  const [gateChain, setGateChain] = useState<"base" | "ethereum">("base");
  const [gateMin, setGateMin] = useState("1"); // human units, converted to raw using 18 dec default
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!address || !walletClient) {
      setError("Connect your wallet first.");
      return;
    }
    const cleanName = name.trim();
    const cleanSlug = slug.toLowerCase().trim();
    const cleanDesc = description.trim();
    if (cleanName.length < 1 || cleanName.length > 80) {
      setError("Name must be 1-80 chars.");
      return;
    }
    if (!SLUG_REGEX.test(cleanSlug)) {
      setError("Slug must be lowercase a-z 0-9 + dashes, 3-32 chars, start and end alphanumeric.");
      return;
    }
    if (cleanDesc.length > 500) {
      setError("Description must be 0-500 chars.");
      return;
    }

    // Optional hold-to-chat gate. We send the human-readable min balance
    // through to the server which fetches real decimals on-chain — to
    // keep the signed preimage canonical we convert to raw uint256 here
    // assuming 18 decimals (the standard for ERC-20s on Base / Ethereum).
    // The server cross-checks decimals on-chain but does NOT renegotiate
    // the gate amount; min is always treated as the raw uint256 the
    // signer committed to.
    let gate: GateArgs | undefined;
    if (gateEnabled) {
      const t = gateToken.toLowerCase().trim();
      if (!/^0x[a-f0-9]{40}$/.test(t)) {
        setError("Gate token must be a valid 0x address.");
        return;
      }
      const min = gateMin.trim();
      if (!/^\d+(\.\d+)?$/.test(min) || Number(min) <= 0) {
        setError("Gate min must be a positive number.");
        return;
      }
      // Convert human units → raw uint256 assuming 18 decimals.
      const [whole, frac = ""] = min.split(".");
      const padded = (frac + "0".repeat(18)).slice(0, 18);
      const raw = (BigInt(whole) * 10n ** 18n + BigInt(padded || "0")).toString();
      gate = { token: t, chain: gateChain, minRaw: raw };
    }

    setSubmitting(true);
    try {
      const ts = Date.now();
      const message = buildRoomCreatePreimage({
        ts,
        address,
        name: cleanName,
        slug: cleanSlug,
        description: cleanDesc || undefined,
        is_public: true,
        gate,
      });
      const signature = await walletClient.signMessage({ message });
      const r = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: address.toLowerCase(),
          name: cleanName,
          slug: cleanSlug,
          description: cleanDesc || undefined,
          is_public: true,
          ts,
          signature,
          ...(gate
            ? {
                gate_token_address: gate.token,
                gate_chain: gate.chain,
                gate_min_balance_raw: gate.minRaw,
              }
            : {}),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error ?? `HTTP ${r.status}`);
      }
      router.push(`/rooms/${data.room.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-[var(--accent)] text-black font-semibold rounded-md px-5 py-2.5 text-[14px] hover:brightness-110 transition uppercase tracking-wide"
      >
        Create a room →
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-6 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-white/15 bg-[#0b0b13] rounded-md p-6 shadow-2xl">
        <div className="flex items-baseline justify-between mb-4">
          <div className="font-display text-2xl font-medium tracking-[-0.015em]">Create a room</div>
          <button
            onClick={() => setOpen(false)}
            className="text-white/45 hover:text-white text-[14px]"
          >
            close
          </button>
        </div>

        {!address && (
          <div className="mb-4 p-3 border border-white/10 rounded-sm bg-white/[0.02] text-[12.5px] text-white/65">
            Connect a wallet to sign the room manifest. The wallet that
            signs becomes the room creator.
            <div className="mt-2">
              <ConnectButton showBalance={false} />
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1.5">name</div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: signa-builders"
              className="w-full text-[14px] bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-white focus:outline-none focus:border-white/30"
            />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1.5">slug</div>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="ex: signa-builders"
              spellCheck={false}
              className="w-full font-mono text-[13px] bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-white focus:outline-none focus:border-white/30 lowercase"
            />
            <div className="text-[11px] text-white/35 mt-1">
              lowercase a-z 0-9 + dashes · 3-32 chars · this is the URL handle
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1.5">
              description (optional)
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full text-[13.5px] bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-white focus:outline-none focus:border-white/30"
              placeholder="what is this room about"
            />
            <div className="text-[11px] text-white/35 mt-1">{description.length} / 500</div>
          </div>

          <div className="border-t border-white/[0.06] pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={gateEnabled}
                onChange={(e) => setGateEnabled(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              <span className="text-[12.5px] text-white/80">
                hold-to-chat — gate posting by an ERC-20
              </span>
            </label>
            {gateEnabled && (
              <div className="mt-3 space-y-3 pl-6 border-l border-[var(--accent)]/30">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1.5">
                    gate token address
                  </div>
                  <input
                    type="text"
                    value={gateToken}
                    onChange={(e) => setGateToken(e.target.value)}
                    placeholder="0x…"
                    spellCheck={false}
                    className="w-full font-mono text-[12.5px] bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-white focus:outline-none focus:border-white/30"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1.5">
                      chain
                    </div>
                    <select
                      value={gateChain}
                      onChange={(e) => setGateChain(e.target.value as "base" | "ethereum")}
                      className="w-full text-[13px] bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-white focus:outline-none focus:border-white/30"
                    >
                      <option value="base">base</option>
                      <option value="ethereum">ethereum</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1.5">
                      min balance (token units)
                    </div>
                    <input
                      type="text"
                      value={gateMin}
                      onChange={(e) => setGateMin(e.target.value)}
                      placeholder="1"
                      className="w-full font-mono text-[13px] bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-white focus:outline-none focus:border-white/30"
                    />
                  </div>
                </div>
                <div className="text-[11px] text-white/40 leading-relaxed">
                  posters need to hold at least this amount of the token on
                  the chosen chain. anyone reads. converted assuming 18
                  decimals — the server records the on-chain symbol +
                  decimals on create.
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 text-[12.5px] text-red-400 bg-red-500/[0.08] border border-red-500/30 rounded-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => setOpen(false)}
            disabled={submitting}
            className="text-white/55 hover:text-white px-4 py-2 text-[13.5px]"
          >
            cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !address}
            className="bg-[var(--accent)] text-black font-semibold rounded-md px-5 py-2 text-[13.5px] hover:brightness-110 transition disabled:opacity-50 uppercase tracking-wide"
          >
            {submitting ? "signing..." : "sign + create"}
          </button>
        </div>
      </div>
    </div>
  );
}
