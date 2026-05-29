"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useWalletClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { keccak256, toBytes, type Address } from "viem";
import { base } from "viem/chains";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

// Same ABI as web/lib/onchain-rooms.ts but client-trimmed to just anchor().
const ANCHOR_ABI = [
  {
    type: "function",
    name: "anchor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "slug", type: "string" },
      { name: "manifestHash", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

interface AnchorConfig {
  deployed: boolean;
  address: Address | null;
  chain_id: number | null;
}

interface CreatedRoom {
  slug: string;
  signed_message: string;
}

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

function parseMembersList(input: string, creator: string | undefined): string[] {
  const raw = input
    .split(/[\s,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[a-f0-9]{40}$/.test(s));
  const set = new Set(raw);
  if (creator) set.add(creator.toLowerCase());
  return [...set];
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

  // v0.80 — encrypted room toggle + member list.
  const [encryptedEnabled, setEncryptedEnabled] = useState(false);
  const [memberInput, setMemberInput] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // v0.53 — anchor flow: after the room is created we show the anchor
  // CTA if the contract is deployed on Base. createdRoom holds the
  // post-create state so the dialog can transition to the anchor view.
  const [anchorConfig, setAnchorConfig] = useState<AnchorConfig | null>(null);
  const [createdRoom, setCreatedRoom] = useState<CreatedRoom | null>(null);
  const [anchoring, setAnchoring] = useState(false);
  const [anchorTx, setAnchorTx] = useState<string | null>(null);
  const [anchorError, setAnchorError] = useState<string | null>(null);

  // Read whether the registry is deployed once the dialog opens.
  useEffect(() => {
    if (!open || anchorConfig) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/anchor-config");
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (d?.ok) {
          setAnchorConfig({
            deployed: !!d.deployed,
            address: d.address ?? null,
            chain_id: d.chain_id ?? null,
          });
        }
      } catch {
        // ignore — anchor section just hides
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, anchorConfig]);

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

    // v0.80 — encrypted rooms are private + carry an explicit member
    // list (including the creator). Encrypted + gated is allowed; the
    // gate becomes purely advisory since membership already gates writes.
    let members: string[] = [];
    if (encryptedEnabled) {
      members = parseMembersList(memberInput, address);
      if (members.length < 2) {
        setError(
          "Encrypted rooms need at least 1 invitee (you are added automatically).",
        );
        return;
      }
      if (members.length > 50) {
        setError("Encrypted rooms support up to 50 members in v0.80.");
        return;
      }
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
      // Encrypted rooms are forced private (is_public=false) so the
      // signed preimage commits to that and the server rejects mixed
      // requests. Plaintext rooms stay public by default.
      const isPublic = !encryptedEnabled;
      const message = buildRoomCreatePreimage({
        ts,
        address,
        name: cleanName,
        slug: cleanSlug,
        description: cleanDesc || undefined,
        is_public: isPublic,
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
          is_public: isPublic,
          ts,
          signature,
          ...(gate
            ? {
                gate_token_address: gate.token,
                gate_chain: gate.chain,
                gate_min_balance_raw: gate.minRaw,
              }
            : {}),
          ...(encryptedEnabled
            ? { is_encrypted: true, members }
            : {}),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error ?? `HTTP ${r.status}`);
      }

      // v0.53 — if the registry is deployed, pause on a success state with
      // the anchor CTA. Otherwise jump straight to the room.
      if (anchorConfig?.deployed) {
        setCreatedRoom({
          slug: data.room.slug,
          // The server echoes the canonical signed message it just persisted.
          signed_message: message,
        });
      } else {
        router.push(`/rooms/${data.room.slug}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function anchor() {
    setAnchorError(null);
    if (!createdRoom || !walletClient || !anchorConfig?.address) return;
    setAnchoring(true);
    try {
      const manifestHash = keccak256(toBytes(createdRoom.signed_message));
      const hash = await walletClient.writeContract({
        address: anchorConfig.address,
        abi: ANCHOR_ABI,
        functionName: "anchor",
        args: [createdRoom.slug, manifestHash],
        chain: base,
      });
      setAnchorTx(hash);
    } catch (e) {
      setAnchorError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnchoring(false);
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

  // Post-create anchor view — only rendered when the registry is deployed
  // AND the room was just created. Two states: pre-tx and post-tx.
  if (open && createdRoom && anchorConfig?.deployed) {
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-6 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-lg border border-white/15 bg-[#0b0b13] rounded-md p-6 shadow-2xl">
          <div className="flex items-baseline justify-between mb-4">
            <div className="font-display text-2xl font-medium tracking-[-0.015em]">
              Room created
            </div>
            <button
              onClick={() => router.push(`/rooms/${createdRoom.slug}`)}
              className="text-white/45 hover:text-white text-[14px]"
            >
              open room →
            </button>
          </div>

          <div className="text-[13px] text-white/65 leading-relaxed mb-4">
            <span className="text-white">#{createdRoom.slug}</span> is live and
            wallet-signed. Anchor it on Base so federated nodes can verify
            the room identity without trusting any one server.
          </div>

          {anchorTx ? (
            <div className="border border-emerald-300/40 bg-emerald-300/[0.06] rounded-sm p-4 mb-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300 mb-2">
                anchor tx submitted
              </div>
              <div className="text-[12.5px] text-white/75 mb-2">
                Your wallet broadcast the anchor() call. Once the tx
                confirms, the room shows ANCHORED ON BASE on its header.
              </div>
              <a
                href={`https://basescan.org/tx/${anchorTx}`}
                target="_blank"
                rel="noreferrer"
                className="block text-[11px] font-mono text-white/55 hover:text-white break-all"
              >
                {anchorTx}
              </a>
            </div>
          ) : (
            <div className="border border-white/10 rounded-sm bg-white/[0.02] p-4 mb-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-2">
                anchor on base · ~$0.01 gas
              </div>
              <div className="text-[12.5px] text-white/65 leading-relaxed mb-3">
                Your wallet calls{" "}
                <code className="text-white/85">anchor(slug, manifestHash)</code>{" "}
                on{" "}
                <code className="text-white/85">SignaRoomRegistry</code>.
                First-write wins — the slug becomes globally yours on
                Base.
              </div>
              <div className="text-[10.5px] font-mono text-white/40 break-all mb-3">
                registry: {anchorConfig.address}
              </div>
              {anchorError && (
                <div className="text-[12px] text-red-400 bg-red-500/[0.08] border border-red-500/30 rounded-sm px-3 py-2 mb-3">
                  {anchorError}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={anchor}
                  disabled={anchoring}
                  className="bg-[var(--accent)] text-black font-semibold rounded-sm px-4 py-2 text-[13px] hover:brightness-110 transition disabled:opacity-50 uppercase tracking-wide"
                >
                  {anchoring ? "signing tx…" : "anchor on base"}
                </button>
                <button
                  onClick={() => router.push(`/rooms/${createdRoom.slug}`)}
                  className="text-white/55 hover:text-white px-4 py-2 text-[13px]"
                >
                  skip for now
                </button>
              </div>
            </div>
          )}

          {anchorTx && (
            <div className="flex justify-end">
              <button
                onClick={() => router.push(`/rooms/${createdRoom.slug}`)}
                className="bg-[var(--accent)] text-black font-semibold rounded-sm px-5 py-2 text-[13.5px] hover:brightness-110 transition uppercase tracking-wide"
              >
                open room →
              </button>
            </div>
          )}
        </div>
      </div>
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
                checked={encryptedEnabled}
                onChange={(e) => setEncryptedEnabled(e.target.checked)}
                className="accent-fuchsia-300"
              />
              <span className="text-[12.5px] text-white/80">
                end-to-end encrypted — private room with sealed-box per member
              </span>
            </label>
            {encryptedEnabled && (
              <div className="mt-3 space-y-3 pl-6 border-l border-fuchsia-300/30">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1.5">
                    member wallets · one per line or comma-separated
                  </div>
                  <textarea
                    value={memberInput}
                    onChange={(e) => setMemberInput(e.target.value)}
                    rows={4}
                    spellCheck={false}
                    placeholder={"0xabc…1234\n0xdef…5678"}
                    className="w-full font-mono text-[12.5px] bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-white focus:outline-none focus:border-white/30"
                  />
                  <div className="text-[11px] text-white/40 mt-1 leading-relaxed">
                    you are added automatically. each member must open this
                    room once so their X25519 pubkey publishes — only then
                    can the next message encrypt to them. max 50 members in
                    v0.80.
                  </div>
                </div>
                <div className="text-[11px] text-white/55 leading-relaxed">
                  encrypted rooms are <span className="text-fuchsia-300">always private</span>{" "}
                  and ignore the hold-to-chat gate — membership IS the gate.
                  ciphertext is{" "}
                  <code className="text-white/85">signa-sealedbox-v1</code>{" "}
                  (libsodium-style box per member). the server never sees
                  your plaintext or your secret key.
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-white/[0.06] pt-4">
            <label className={`flex items-center gap-2 cursor-pointer ${encryptedEnabled ? "opacity-40 pointer-events-none" : ""}`}>
              <input
                type="checkbox"
                checked={gateEnabled}
                onChange={(e) => setGateEnabled(e.target.checked)}
                disabled={encryptedEnabled}
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
