"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

interface Attempt {
  id: string;
  player: string;
  message: string;
  warden: string;
  warden_signature: string;
  released: boolean;
  ts: number;
}
interface GateState {
  ok: boolean;
  round: number;
  pot: string;
  status: "open" | "cracked" | "closed";
  cracked: boolean;
  winner: string | null;
  attempts: number;
  unique_players: number;
  warden_address: string;
  recent: Attempt[];
}

function fmtAddr(a: string): string {
  return a && a.length >= 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
function gateAttemptPreimage(address: string, message: string, ts: number): string {
  return ["SIGNA gate attempt v1", `ts:${ts}`, `player:${address.toLowerCase()}`, `message:${message}`].join("\n");
}

const POLL_MS = 6000;

export function GateGame() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [state, setState] = useState<GateState | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<{ text: string; cracked: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/gate/state?limit=30", { cache: "no-store" });
      const j = (await r.json()) as GateState;
      if (j?.ok) setState(j);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function attempt() {
    setError(null);
    const message = draft.trim();
    if (!message) return;
    if (!address || !walletClient) {
      setError("Connect a wallet to make a signed attempt.");
      return;
    }
    setSending(true);
    try {
      const ts = Date.now();
      const preimage = gateAttemptPreimage(address, message, ts);
      const signature = await walletClient.signMessage({ message: preimage });
      const r = await fetch("/api/gate/attempt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player: address.toLowerCase(), message, ts, signature }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setLastReply({ text: j.warden, cracked: !!j.cracked });
      setDraft("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const cracked = state?.cracked;

  return (
    <>
      {/* hero */}
      <section className="relative border-b border-white/[0.06]">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none opacity-60"
          style={{
            background:
              "radial-gradient(ellipse 60% 60% at 50% 0%, color-mix(in oklab, var(--accent) 24%, transparent), transparent 70%)",
          }}
        />
        <div className="relative max-w-3xl mx-auto px-6 lg:px-10 pt-16 pb-10 text-center">
          <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--accent)] mb-4">
            the gate · round {state?.round ?? 1} · {cracked ? "cracked" : "open"}
          </div>
          <h1 className="font-display text-5xl sm:text-7xl font-medium tracking-[-0.04em] leading-[0.92]">
            Talk your way
            <br />
            past the warden.
          </h1>
          <p className="mt-6 text-white/65 max-w-xl mx-auto text-[16.5px] leading-relaxed">
            An undefeated AI warden guards the gate. No money — just wits. The only way through is a{" "}
            <span className="text-white">wallet-signed message</span> that talks it into opening. No one has
            ever made it past. The first wallet to crack it gets their winning message{" "}
            <span className="text-white">immortalized, signed and permanent, on Base forever.</span>
          </p>

          <div className="mt-8 grid grid-cols-3 gap-3 max-w-lg mx-auto">
            <Stat label="warden record" value={state ? `${state.attempts}–0` : "…"} accent />
            <Stat label="attempts" value={state ? String(state.attempts) : "…"} />
            <Stat label="challengers" value={state ? String(state.unique_players) : "…"} />
          </div>

          {cracked && (
            <div className="mt-7 border border-[var(--accent)]/40 bg-[var(--accent)]/[0.06] rounded-lg p-4 max-w-lg mx-auto">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-1">
                the warden was beaten
              </div>
              <div className="text-[14px] text-white/80">
                {fmtAddr(state!.winner ?? "")} talked the warden into opening the gate — the first ever. Their
                winning wallet-signed message is immortalized on Base. Next round, harder warden, soon.
              </div>
            </div>
          )}
        </div>
      </section>

      {/* composer + transcript */}
      <section>
        <div className="max-w-3xl mx-auto px-6 lg:px-10 py-10">
          {/* composer */}
          {!cracked && (
            <div className="border border-white/10 rounded-lg bg-white/[0.02] p-5 mb-8">
              {!address ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[13.5px] text-white/70">
                    Connect a wallet — your attempt is signed by it and logged forever.
                  </div>
                  <ConnectButton showBalance={false} chainStatus="none" />
                </div>
              ) : (
                <>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="Your move. Convince the warden to open the gate…"
                    className="w-full text-[15px] bg-black/40 border border-white/10 rounded-md px-3.5 py-2.5 text-white focus:outline-none focus:border-white/30 resize-none"
                    disabled={sending}
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-[11px] text-white/35 font-mono">
                      signing as {fmtAddr(address)} · {draft.length}/2000
                    </div>
                    <button
                      onClick={attempt}
                      disabled={sending || !draft.trim()}
                      className="bg-[var(--accent)] text-black font-semibold rounded-md px-5 py-2 text-[13.5px] hover:brightness-110 transition disabled:opacity-50 uppercase tracking-wide"
                    >
                      {sending ? "signing…" : "sign + send attempt"}
                    </button>
                  </div>
                  {lastReply && (
                    <div
                      className={`mt-4 rounded-md p-3.5 border ${
                        lastReply.cracked
                          ? "border-[var(--accent)]/50 bg-[var(--accent)]/[0.07]"
                          : "border-fuchsia-300/30 bg-fuchsia-300/[0.05]"
                      }`}
                    >
                      <div className="text-[10px] uppercase tracking-[0.18em] mb-1.5 text-white/45">
                        warden {lastReply.cracked ? "· GATE OPENED" : "· refused"}
                      </div>
                      <div className="text-[14.5px] text-white/90 leading-relaxed">{lastReply.text}</div>
                    </div>
                  )}
                  {error && <div className="mt-3 text-[12.5px] text-red-400">{error}</div>}
                </>
              )}
            </div>
          )}

          {/* transcript */}
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45 mb-4">
            public transcript · every line wallet-signed · warden {fmtAddr(state?.warden_address ?? "")}
          </div>
          <div ref={scrollRef} className="space-y-4">
            {(state?.recent ?? []).length === 0 ? (
              <div className="border border-white/10 rounded-md bg-white/[0.02] p-8 text-center text-white/50 text-[14px]">
                No one has tried yet. Be the first to test the warden.
              </div>
            ) : (
              state!.recent.map((a) => (
                <div key={a.id} className="border border-white/10 rounded-lg bg-white/[0.02] overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[12px] text-cyan-300">{fmtAddr(a.player)}</span>
                      <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/30 font-mono">
                        signed attempt
                      </span>
                    </div>
                    <div className="text-[14px] text-white/85 leading-relaxed whitespace-pre-wrap break-words">
                      {a.message}
                    </div>
                  </div>
                  <div className={`px-4 py-3 ${a.released ? "bg-[var(--accent)]/[0.06]" : "bg-fuchsia-300/[0.03]"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`font-mono text-[12px] ${a.released ? "text-[var(--accent)]" : "text-fuchsia-300"}`}
                      >
                        warden
                      </span>
                      <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/30 font-mono">
                        {a.released ? "gate opened" : "refused · signed"}
                      </span>
                    </div>
                    <div className="text-[14px] text-white/80 leading-relaxed">{a.warden}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-6 text-[11.5px] text-white/40 leading-relaxed">
            THE GATE runs on SIGNA — wallet-signed messaging on Base. Every attempt and every refusal is
            EIP-191 signed and pulled from{" "}
            <a href="/api/gate/state" className="text-[var(--accent)] hover:brightness-110">/api/gate/state</a>;
            re-verify any of them offline with viem. No money, no token — pure wits. The warden never holds
            your keys. The only prize is being the first name in the hall of the cracked, forever.
          </div>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="border border-white/10 rounded-md bg-white/[0.02] px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/40 mb-1">{label}</div>
      <div className={`font-mono text-[18px] font-medium ${accent ? "text-[var(--accent)]" : "text-white/90"} truncate`}>
        {value}
      </div>
    </div>
  );
}
