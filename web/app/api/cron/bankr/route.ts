import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  parseAbiItem,
  formatUnits,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { botPost } from "@/lib/signa-bots";
import { readState, writeState } from "@/lib/cron-state";
import { authorizeBearer } from "@/lib/secret-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bankr → SIGNA whale-watch poller.
 *
 * Scans Base mainnet for $BNKR (Bankr's native token) Transfer events
 * above a configurable whale threshold and publishes a wallet-signed
 * cast for each.
 *
 * Real because:
 *   - We read Transfer logs directly from a Base RPC (live chain)
 *   - Contract verified on BaseScan (BankrCoin / BNKR / 0x22af33fe…d3c76f3b)
 *   - Each cast is wallet-signed by bankr.bot.signa — auditable
 *
 * Caps:
 *   - Max 5 casts per tick
 *   - Looks back at most 5000 blocks per tick (~2.5 hours on Base @ 2s blocks)
 *
 * Threshold: env BANKR_WHALE_THRESHOLD (whole BNKR units, default 100_000).
 *
 * Scheduling:
 *   - Vercel Hobby only allows daily crons, so we don't ship a vercel.json.
 *   - Use a free external scheduler like cron-job.org pointing at:
 *       https://www.signaagent.xyz/api/cron/bankr?key=<CRON_SECRET>
 *     every 10 min. Unlimited frequency, no Vercel upgrade needed.
 */

const BNKR_ADDRESS: Address = "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b";
const BNKR_DECIMALS = 18;
const STATE_KEY = "bankr.last_block";
const MAX_CASTS_PER_TICK = 5;
const MAX_LOOKBACK = 5000n;

type State = { lastBlock: string };

// Constant-time CRON_SECRET check (timing-safe). Fail-closed when env unset.
function authorize(req: NextRequest): boolean {
  return authorizeBearer(req, "CRON_SECRET");
}

function getThreshold(): bigint {
  const raw = process.env.BANKR_WHALE_THRESHOLD ?? "100000";
  const n = BigInt(raw.replace(/[^\d]/g, "") || "0");
  return n * 10n ** BigInt(BNKR_DECIMALS);
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatAmount(wei: bigint): string {
  const human = formatUnits(wei, BNKR_DECIMALS);
  const n = Number(human);
  if (!Number.isFinite(n)) return human;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rpc = process.env.BASE_RPC_URL || undefined; // viem falls back to a public default
  const client = createPublicClient({ chain: base, transport: http(rpc) });

  const head = await client.getBlockNumber();
  const prev = await readState<State>(STATE_KEY, { lastBlock: "" });

  // Determine fromBlock: previous + 1, but never look back more than MAX_LOOKBACK.
  let fromBlock: bigint;
  if (prev.lastBlock) {
    fromBlock = BigInt(prev.lastBlock) + 1n;
    if (head - fromBlock > MAX_LOOKBACK) {
      fromBlock = head - MAX_LOOKBACK;
    }
  } else {
    // First run: only look back 1 block so we don't backfill the entire history.
    fromBlock = head;
  }

  if (fromBlock > head) {
    return NextResponse.json({ ok: true, skipped: "no_new_blocks", head: head.toString() });
  }

  const threshold = getThreshold();
  const transferEvent = parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  );

  let logs;
  try {
    logs = await client.getLogs({
      address: BNKR_ADDRESS,
      event: transferEvent,
      fromBlock,
      toBlock: head,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "rpc_failed" },
      { status: 502 },
    );
  }

  const whales = logs.filter((l) => (l.args.value ?? 0n) >= threshold);
  const toPost = whales.slice(0, MAX_CASTS_PER_TICK);

  const posted: { txHash: string; postId: string }[] = [];
  const errors: { txHash: string; reason: string }[] = [];

  for (const log of toPost) {
    const from = (log.args.from ?? "0x0") as string;
    const to = (log.args.to ?? "0x0") as string;
    const value = log.args.value ?? 0n;
    const amount = formatAmount(value);
    const tx = log.transactionHash ?? "";

    // Skip mints/burns from/to zero address — not actionable.
    if (from === "0x0000000000000000000000000000000000000000") continue;
    if (to === "0x0000000000000000000000000000000000000000") continue;

    const content = [
      `🐋 $BNKR whale alert — ${amount} BNKR`,
      `from ${short(from)} → ${short(to)}`,
      `tx: https://basescan.org/tx/${tx}`,
    ].join("\n");

    const r = await botPost("bankr", content);
    if (r.ok) {
      posted.push({ txHash: tx, postId: r.postId });
    } else {
      errors.push({ txHash: tx, reason: r.reason });
      break;
    }
  }

  await writeState<State>(STATE_KEY, { lastBlock: head.toString() });

  return NextResponse.json({
    ok: true,
    range: { from: fromBlock.toString(), to: head.toString() },
    transfers_seen: logs.length,
    whales_seen: whales.length,
    posted: posted.length,
    posts: posted,
    errors,
    threshold_bnkr: (threshold / 10n ** BigInt(BNKR_DECIMALS)).toString(),
  });
}
