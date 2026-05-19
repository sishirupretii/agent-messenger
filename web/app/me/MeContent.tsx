"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Spinner } from "@/components/ui/Spinner";
import { X402PriceControl } from "@/components/agent/X402PriceControl";
import { PeerAvatar } from "@/components/ui/Avatar";
import { shortAddress } from "@/lib/format";
import { formatUsd, formatPct } from "@/lib/geckoterminal";
import { getWatchlist } from "@/lib/watchlist";
import { useChat } from "@/context/ChatProvider";
import { isDm } from "@/lib/conversation";
import { DigestToggle } from "./DigestToggle";
import { BankrConnect } from "./BankrConnect";
import type { Position, PortfolioSnapshot } from "@/lib/portfolio";

/**
 * Personal command center. Renders entirely from the connected wallet
 * + localStorage watchlist. No auth needed — anyone connecting their
 * wallet sees their own /me view; refresh and it's gone.
 */
export function MeContent() {
  const { address, isConnected } = useAccount();
  const { client, conversations, peerInfoByConvId, initStatus, initXmtp } =
    useChat();
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [agents, setAgents] = useState<LaunchedAgent[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const wl = getWatchlist();
      setWatchlist(wl);

      const [pRes, aRes] = await Promise.all([
        fetch(
          `/api/me/portfolio?address=${address.toLowerCase()}&watchlist=${wl.join(",")}`,
          { cache: "no-store" },
        ),
        fetch("/api/agents", { cache: "no-store" }),
      ]);
      const p = await pRes.json().catch(() => null);
      const a = await aRes.json().catch(() => ({ agents: [] }));
      if (p?.ok) setPortfolio(p as PortfolioSnapshot);
      const launched = (a.agents ?? []).filter(
        (x: LaunchedAgent) =>
          x.launched_by?.toLowerCase() === address.toLowerCase() &&
          x.launched_at,
      );
      setAgents(launched);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!isConnected || !address) {
    return (
      <section className="border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-16 pb-16">
          <div className="font-mono text-[11px] text-[var(--accent)] mb-4">
            $ signa whoami
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-0.035em] leading-[1.02]">
            connect to see your crypto.
          </h1>
          <p className="text-white/65 max-w-lg mt-5 text-[15px] leading-relaxed">
            one tab for your portfolio, watchlist, agents, DMs, and the
            tokens you&apos;re launching. wallet-native, on-chain
            verified, no signup.
          </p>
          <div className="mt-7">
            <ConnectButton.Custom>
              {({ openConnectModal, mounted }) => (
                <button
                  onClick={openConnectModal}
                  disabled={!mounted}
                  className="text-[var(--accent)] font-mono hover:underline underline-offset-4 disabled:opacity-50"
                >
                  [ connect wallet ]
                </button>
              )}
            </ConnectButton.Custom>
          </div>
        </div>
      </section>
    );
  }

  const total = portfolio?.total_usd ?? 0;
  const change = portfolio?.change_24h_usd ?? 0;
  const changePct = portfolio?.change_24h_pct ?? 0;
  const positions = portfolio?.positions ?? [];

  return (
    <>
      {/* Header — net worth */}
      <section className="border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-6 lg:px-10 pt-12 pb-10">
          <div className="font-mono text-[11px] text-[var(--accent)] mb-4">
            $ signa portfolio --address {shortAddress(address)}
          </div>
          <div className="flex items-start gap-4">
            <PeerAvatar address={address} size={56} />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] uppercase tracking-wider text-white/40 mb-1">
                net worth
              </div>
              {loading && !portfolio ? (
                <Spinner size={20} />
              ) : (
                <>
                  <div className="font-display text-4xl sm:text-5xl font-semibold tracking-[-0.035em] leading-none tabular-nums">
                    {formatUsd(total)}
                  </div>
                  <div
                    className={`mt-2 text-[14px] font-mono tabular-nums ${
                      change >= 0 ? "text-emerald-300" : "text-rose-300"
                    }`}
                  >
                    {change >= 0 ? "+" : ""}
                    {formatUsd(Math.abs(change))} ({formatPct(changePct)})
                    {" "}
                    <span className="text-white/35">24h</span>
                  </div>
                </>
              )}
              <div className="text-[11px] font-mono text-white/35 mt-2 break-all">
                {address}
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] font-mono">
            <Link
              href="/tokens"
              className="text-[var(--accent)] hover:underline underline-offset-4"
            >
              find tokens
            </Link>
            <Link
              href="/launch-agent"
              className="text-[var(--accent)] hover:underline underline-offset-4"
            >
              spawn-agent
            </Link>
            <Link
              href={`/u/${address.toLowerCase()}`}
              className="text-[var(--accent)] hover:underline underline-offset-4"
            >
              public profile
            </Link>
            <button
              onClick={refresh}
              disabled={loading}
              className="text-white/45 hover:text-white"
            >
              {loading ? "refreshing…" : "↻ refresh"}
            </button>
          </div>
        </div>
      </section>

      {/* Positions */}
      <section className="border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-6 lg:px-10 py-8">
          <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
            $ signa positions
          </div>
          {positions.length === 0 ? (
            <div className="border border-dashed border-white/15 px-6 py-8 font-mono text-[12px] text-white/55">
              <div className="text-white/85 mb-2">{`>`} no positions found.</div>
              <div className="text-white/40 mb-3">
                {`>`} scanned ETH, USDC, $BNKR, $GITLAWB, $MIROSHARK and{" "}
                {watchlist.length} watchlisted token{watchlist.length === 1 ? "" : "s"}.
              </div>
              <Link
                href="/tokens"
                className="text-[var(--accent)] hover:brightness-125 underline underline-offset-4"
              >
                browse tokens to add to your watchlist →
              </Link>
            </div>
          ) : (
            <div className="border border-white/10 bg-black/30 font-mono text-[12px] leading-[1.7]">
              <div className="grid grid-cols-[minmax(0,2fr)_120px_120px_100px] gap-3 px-3 py-2 border-b border-white/10 text-white/40 uppercase tracking-wider text-[10px]">
                <span>token</span>
                <span className="text-right">balance</span>
                <span className="text-right">price · 24h</span>
                <span className="text-right">value</span>
              </div>
              {positions.map((p) => (
                <PositionRow key={`${p.address}-${p.symbol}`} pos={p} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Recent DMs */}
      <section className="border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-6 lg:px-10 py-8">
          <div className="font-mono text-[11px] text-[var(--accent)] mb-3 flex items-center justify-between gap-3">
            <span>$ signa dms --recent</span>
            <Link
              href="/"
              className="text-[10px] text-white/45 hover:text-white normal-case tracking-normal"
            >
              all DMs →
            </Link>
          </div>
          {!client ? (
            <div className="border border-dashed border-white/15 px-4 py-5 font-mono text-[12px] text-white/65">
              <div className="text-white/85 mb-2">
                {`>`} XMTP not enabled in this tab.
              </div>
              <div className="text-white/40 mb-3">
                {`>`} one signature to derive your XMTP identity from your wallet
                — no gas, no password, ~10-30s.
              </div>
              <button
                onClick={initXmtp}
                disabled={initStatus === "loading"}
                className="text-[var(--accent)] hover:underline underline-offset-4 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {initStatus === "loading" && (
                  <Spinner size={10} className="text-[var(--accent)]" />
                )}
                {initStatus === "loading" ? "[ signing… ]" : "[ enable messaging ]"}
              </button>
            </div>
          ) : conversations.length === 0 ? (
            <div className="border border-dashed border-white/15 px-4 py-5 font-mono text-[12px] text-white/55">
              <div className="text-white/85 mb-2">{`>`} no conversations yet.</div>
              <div className="text-white/40">
                {`>`} DM anyone by basename / ENS / 0x at{" "}
                <Link
                  href="/directory"
                  className="text-[var(--accent)] hover:brightness-125 underline underline-offset-4"
                >
                  /directory
                </Link>
                {" or "}
                <Link
                  href="/launchpad"
                  className="text-[var(--accent)] hover:brightness-125 underline underline-offset-4"
                >
                  /launchpad
                </Link>
                .
              </div>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {conversations.slice(0, 6).map((conv) => {
                const peer = peerInfoByConvId.get(conv.id);
                const peerAddr = peer?.address ?? null;
                const isGroup = !isDm(conv);
                const linkHref = peerAddr ? `/?to=${peerAddr}` : "/";
                return (
                  <Link
                    key={conv.id}
                    href={linkHref}
                    className="border border-white/10 px-3 py-3 hover:bg-white/[0.03] transition group flex items-start gap-2.5"
                  >
                    {isGroup ? (
                      <span className="size-8 flex items-center justify-center flex-shrink-0 border border-white/15 text-white/55 font-mono text-[11px]">
                        [G]
                      </span>
                    ) : (
                      <PeerAvatar address={peerAddr} size={32} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[13px] text-white font-medium truncate">
                          {isGroup ? (
                            <>group · {conversations.length} members</>
                          ) : peerAddr ? (
                            shortAddress(peerAddr, 6, 4)
                          ) : (
                            "unknown peer"
                          )}
                        </span>
                        <span className="text-white/30 group-hover:text-white flex-shrink-0 text-[12px]">↗</span>
                      </div>
                      <div className="text-[10px] text-white/40 font-mono truncate mt-0.5">
                        {peerAddr ? peerAddr : conv.id.slice(0, 24) + "…"}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Launched agents */}
      {agents.length > 0 && (
        <section className="border-b border-white/[0.06]">
          <div className="max-w-4xl mx-auto px-6 lg:px-10 py-8">
            <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
              $ signa list-agents --by me
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {agents.map((a) => (
                <div
                  key={a.address}
                  className="border border-white/10 px-3 py-3 flex items-start gap-3"
                >
                  <PeerAvatar
                    address={a.avatar_seed || a.address}
                    size={32}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/agent/${a.address}`}
                      className="group flex items-center justify-between gap-1"
                    >
                      <span className="text-[14px] text-white font-medium truncate hover:underline underline-offset-4">
                        {a.name}
                      </span>
                      <span className="text-white/30 group-hover:text-white flex-shrink-0 text-[12px]">↗</span>
                    </Link>
                    <div className="text-[10px] font-mono text-white/35 truncate">
                      {a.address.slice(0, 10)}…{a.address.slice(-4)}
                    </div>
                    {a.bankr_token_address && (
                      <div className="text-[10px] mt-1 inline-flex items-center gap-1 text-violet-300 font-mono">
                        ● tokenized
                      </div>
                    )}
                    {/* Wallet-signed x402 price control — owners can charge
                        USDC per /respond call. */}
                    <div className="mt-2 pt-2 border-t border-white/[0.05]">
                      <X402PriceControl agentAddress={a.address} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Watchlist count + CTA */}
      <section className="border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-6 lg:px-10 py-8">
          <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
            $ signa watchlist
          </div>
          {watchlist.length === 0 ? (
            <div className="font-mono text-[12px] text-white/55">
              {`>`} no watchlisted tokens. click{" "}
              <Link
                href="/tokens"
                className="text-[var(--accent)] hover:brightness-125 underline underline-offset-4"
              >
                /tokens
              </Link>
              {" → pick any token → tap [+] to track."}
            </div>
          ) : (
            <div className="font-mono text-[12px] text-white/70">
              tracking {watchlist.length} token{watchlist.length === 1 ? "" : "s"}.
              {" "}
              prices + balances pulled into your portfolio above.
            </div>
          )}
        </div>
      </section>

      <BankrConnect address={address} />

      <DigestToggle address={address} />

      {/* Quick links — manpage SEE ALSO style */}
      <section className="border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-6 lg:px-10 py-8">
          <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
            $ signa actions
          </div>
          <table className="font-mono text-[12px] w-full max-w-2xl border-collapse">
            <tbody>
              <ActionRow
                href="/feed"
                title="/feed"
                hint="post wallet-signed; watch ecosystem alerts"
              />
              <ActionRow
                href="/launchpad"
                title="/launchpad"
                hint="spawn an ai agent · 60s · one tx"
              />
              <ActionRow
                href="/launchpad/top"
                title="/launchpad/top"
                hint="leaderboard by rating + stack depth"
              />
              <ActionRow
                href="/tokens"
                title="/tokens"
                hint="trending + new launches on base"
              />
              <ActionRow
                href="/holders/BNKR"
                title="/holders/BNKR"
                hint="every signa user holding $BNKR"
              />
              <ActionRow
                href="/"
                title="/ (dms)"
                hint="xmtp v3 encrypted by your wallet"
              />
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

type LaunchedAgent = {
  address: string;
  name: string;
  description: string;
  avatar_seed: string | null;
  launched_by: string | null;
  launched_at: string | null;
  bankr_token_address: string | null;
};

function PositionRow({ pos }: { pos: Position }) {
  const change = pos.change_24h_pct;
  const changeColor =
    change == null
      ? "text-white/40"
      : change >= 0
        ? "text-emerald-300"
        : "text-rose-300";
  const linkHref =
    pos.kind === "ETH" ? null : `/tokens/${pos.address}`;
  const body = (
    <>
      <div className="flex items-center gap-2 min-w-0">
        {pos.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pos.image_url}
            alt={pos.symbol}
            width={20}
            height={20}
            className="rounded-full flex-shrink-0"
          />
        ) : (
          <span className="size-5 flex-shrink-0 border border-white/15 text-white/45 font-mono text-[10px] flex items-center justify-center">
            $
          </span>
        )}
        <div className="min-w-0">
          <div className="text-white truncate">
            <span className="font-medium">${pos.symbol}</span>
            <span className="text-white/40 ml-2 text-[10px]">
              {pos.source === "watchlist" ? "watching" : "tracked"}
            </span>
          </div>
          <div className="text-[10px] text-white/35 truncate">{pos.name}</div>
        </div>
      </div>
      <div className="text-right text-white/85 tabular-nums">
        {pos.balance}
      </div>
      <div className="text-right text-white/70 tabular-nums">
        <div>{formatUsd(pos.price_usd)}</div>
        <div className={`text-[10px] ${changeColor}`}>
          {formatPct(pos.change_24h_pct)}
        </div>
      </div>
      <div className="text-right text-white font-medium tabular-nums">
        {formatUsd(pos.value_usd)}
      </div>
    </>
  );

  const className =
    "grid grid-cols-[minmax(0,2fr)_120px_120px_100px] gap-3 px-3 py-2.5 border-b border-white/[0.05] last:border-b-0 hover:bg-white/[0.03] transition-colors items-center";

  if (linkHref) {
    return (
      <Link href={linkHref} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

function ActionRow({
  href,
  title,
  hint,
}: {
  href: string;
  title: string;
  hint: string;
}) {
  return (
    <tr className="align-top">
      <td className="pr-4 py-0.5 whitespace-nowrap w-[150px]">
        <Link
          href={href}
          className="text-[var(--accent)]/85 hover:text-[var(--accent)] hover:underline underline-offset-4"
        >
          {title}
        </Link>
      </td>
      <td className="text-white/55 py-0.5">{hint}</td>
    </tr>
  );
}
