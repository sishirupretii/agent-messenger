/**
 * v0.85 — SIGNAL DESK scoring.
 *
 * A live autonomous SIGNA agent reads real on-chain data for a Base
 * watchlist and emits a transparent "momentum reading" per token. This
 * is descriptive on-chain analytics — it reports what already happened
 * (price move, volume, turnover) plus a composite momentum score. It is
 * NOT investment advice and never tells anyone to buy or sell. Same
 * descriptive bull/neutral/bear shape MiroShark uses for its swarm.
 *
 * Every reading the agent posts is wallet-signed into a public SIGNA
 * room, so its track record is re-verifiable and undeletable. The score
 * formula below is intentionally simple + printed on the card so anyone
 * can recompute it from the same public GeckoTerminal inputs.
 */
import { tokenOnBase, trendingTokensOnBase, type TokenSummary } from "./geckoterminal";

/** Tokens pinned to the top of the board (partner ecosystem on Base). */
export const PINNED_WATCHLIST: { address: string; tag: string }[] = [
  { address: "0xd7bc6a05a56655fb2052f742b012d1dfd66e1ba3", tag: "MIROSHARK" },
  { address: "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b", tag: "BNKR" },
];

export type Call = "bull" | "neutral" | "bear";

export interface Reading {
  address: string;
  symbol: string;
  name: string;
  price_usd: string;
  change_24h_pct: number | null;
  volume_24h_usd: string;
  fdv_usd: string | null;
  /** 0..100 composite momentum score. */
  score: number;
  call: Call;
  /** Per-component breakdown so the score is fully auditable. */
  components: { momentum: number; turnover: number };
  pinned: boolean;
  tag?: string;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Composite momentum score from public on-chain inputs.
 *
 *   momentum = 24h price change, mapped from [-25%, +25%] → [0, 100]
 *   turnover = 24h volume / FDV, mapped from [0, 0.5] → [0, 100]
 *              (how much of the token's value changed hands today)
 *   score    = round(0.6 * momentum + 0.4 * turnover)
 *
 * call: score >= 60 bull · 40..60 neutral · < 40 bear
 */
export function scoreToken(t: TokenSummary): { score: number; call: Call; components: { momentum: number; turnover: number } } {
  const chg = t.change_24h_pct ?? 0;
  const momentum = clamp(((chg + 25) / 50) * 100, 0, 100);

  const fdv = Number(t.fdv_usd ?? 0);
  const vol = Number(t.volume_24h_usd ?? 0);
  const turnoverRatio = fdv > 0 ? vol / fdv : 0;
  const turnover = clamp((turnoverRatio / 0.5) * 100, 0, 100);

  const score = Math.round(0.6 * momentum + 0.4 * turnover);
  const call: Call = score >= 60 ? "bull" : score >= 40 ? "neutral" : "bear";
  return {
    score,
    call,
    components: {
      momentum: Math.round(momentum),
      turnover: Math.round(turnover),
    },
  };
}

function toReading(t: TokenSummary, pinned: boolean, tag?: string): Reading {
  const { score, call, components } = scoreToken(t);
  return {
    address: t.address,
    symbol: t.symbol || tag || "?",
    name: t.name || "",
    price_usd: t.price_usd,
    change_24h_pct: t.change_24h_pct,
    volume_24h_usd: t.volume_24h_usd,
    fdv_usd: t.fdv_usd,
    score,
    call,
    components,
    pinned,
    tag,
  };
}

/**
 * Build the full board: pinned partner tokens first (always shown), then
 * top trending Base tokens to fill it out. Deduped by address.
 */
export async function buildBoard(opts: { trendingCount?: number } = {}): Promise<Reading[]> {
  const trendingCount = opts.trendingCount ?? 6;

  const pinnedResults = await Promise.all(
    PINNED_WATCHLIST.map(async (p) => {
      const t = await tokenOnBase(p.address);
      return t ? toReading(t, true, p.tag) : null;
    }),
  );
  const pinned = pinnedResults.filter((r): r is Reading => r !== null);

  const seen = new Set(pinned.map((r) => r.address));
  const trending = await trendingTokensOnBase(trendingCount + PINNED_WATCHLIST.length);
  const fill: Reading[] = [];
  for (const t of trending) {
    if (fill.length >= trendingCount) break;
    if (!t.address || seen.has(t.address)) continue;
    if (!t.symbol) continue;
    seen.add(t.address);
    fill.push(toReading(t, false));
  }

  // Pinned stay on top in their declared order; trending sorted by score desc.
  fill.sort((a, b) => b.score - a.score);
  return [...pinned, ...fill];
}

/** One-line wallet-signed reading body for the signal-desk room. */
export function readingLine(r: Reading): string {
  const chg =
    r.change_24h_pct == null
      ? "—"
      : `${r.change_24h_pct >= 0 ? "+" : ""}${r.change_24h_pct.toFixed(1)}%`;
  const callTag = r.call.toUpperCase();
  return `$${r.symbol} · ${callTag} ${r.score}/100 · 24h ${chg} · score=0.6·mom(${r.components.momentum})+0.4·turn(${r.components.turnover})`;
}

/** The full digest body the agent signs + posts each cycle. */
export function digestBody(board: Reading[], cycleIso: string): string {
  const lines = [
    `signal desk · base momentum board · ${cycleIso}`,
    ``,
    ...board.map((r, i) => `${String(i + 1).padStart(2)}. ${readingLine(r)}`),
    ``,
    `momentum reading from public on-chain data (geckoterminal). not advice.`,
    `every reading wallet-signed + re-verifiable. score = 0.6*momentum + 0.4*turnover.`,
  ];
  return lines.join("\n");
}

export const CALL_COLORS: Record<Call, string> = {
  bull: "#7af0a8",
  neutral: "#9ad7ff",
  bear: "#ff7ed1",
};
