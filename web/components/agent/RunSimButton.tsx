"use client";

import { useState } from "react";
import { useAccount, useChainId, useReadContract, useSwitchChain, useWalletClient } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  EXPECTED_X402_CHAIN_ID,
  EXPECTED_USDC_ADDRESS,
  FAUCET_URL,
  MirosharkSimResult,
  SIM_PRICE_BASE_UNITS,
  USDC_BALANCE_ABI,
  basescanTxUrl,
  fireMirosharkSim,
  formatUsdcBalance,
} from "@/lib/x402-client";

/**
 * Public "Run a sim" button — v0.26 visitor-pays edition.
 *
 * Any visitor with an EVM wallet (MetaMask, Coinbase, Rainbow, Trust,
 * Phantom, OKX, WalletConnect…) can click → connect → sign → pay $1
 * USDC straight to MiroShark. SIGNA's own wallet never enters the
 * flow. The verdict still auto-posts to /feed/miroshark via the
 * existing MiroShark→SIGNA webhook (attribution rides on the
 * agent_address we include in the request body).
 *
 * UX states are explicit so a visitor never has to guess what they
 * need to do next:
 *   - disconnected → "Connect wallet to fire"
 *   - wrong chain  → "Switch to Base Sepolia"
 *   - 0 USDC       → "Get $1 testnet USDC at faucet.circle.com →"
 *   - ready        → "Fire sim · $1 USDC"
 *   - signing      → "Confirm in your wallet…"
 *   - settled      → wait_url + tx hash on basescan
 *
 * Chain is currently Base Sepolia per Aaron's Railway endpoint. When
 * he flips to mainnet, the single constant flip in x402-client.ts
 * carries through here automatically — including the chain switch
 * prompt and the basescan link.
 */
export function RunSimButton({
  agentAddress,
  agentName,
}: {
  agentAddress: string;
  agentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<MirosharkSimResult | null>(null);

  const { address: account, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: switchPending } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const { openConnectModal } = useConnectModal();

  const onExpectedChain = chainId === EXPECTED_X402_CHAIN_ID;

  // Read the visitor's USDC balance on the expected chain so we can
  // surface "you need $1 USDC" BEFORE they click and sign a doomed
  // authorization. Disabled until they're connected on the right chain
  // (otherwise wagmi spams the wrong RPC).
  const { data: usdcBalance } = useReadContract({
    address: EXPECTED_USDC_ADDRESS,
    abi: USDC_BALANCE_ABI,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId: EXPECTED_X402_CHAIN_ID,
    query: {
      enabled: Boolean(account && onExpectedChain),
      refetchInterval: 15_000,
    },
  });

  const balance = (usdcBalance as bigint | undefined) ?? 0n;
  const hasEnough = balance >= SIM_PRICE_BASE_UNITS;

  const MIN_SCENARIO = 10;
  const MAX_SCENARIO = 500;
  const scenarioValid =
    scenario.trim().length >= MIN_SCENARIO &&
    scenario.trim().length <= MAX_SCENARIO;

  const canFire =
    isConnected && onExpectedChain && hasEnough && scenarioValid && !submitting;

  async function fire() {
    if (!canFire || !walletClient) return;
    setSubmitting(true);
    setResult(null);
    try {
      const out = await fireMirosharkSim({
        walletClient,
        prompt: scenario.trim(),
        agentAddress,
      });
      setResult(out);
    } catch (e) {
      setResult({
        ok: false,
        stage: "fetch_threw",
        message: e instanceof Error ? e.message : "unexpected error",
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
          <span className="font-mono text-[11px] text-cyan-300/90">
            $ miroshark sim
          </span>
          <span className="text-[12.5px] text-white/80">
            Run a swarm simulation against {agentName} · $1 USDC
          </span>
        </div>
        <span className="text-[10px] text-white/40 font-mono">
          {open ? "[hide]" : "[open]"}
        </span>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-3">
          <div className="text-[11px] text-white/55 leading-relaxed">
            Type a scenario the swarm should pre-test. Sim runs on{" "}
            <a
              href="https://github.com/aaronjmars/MiroShark"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300/85 hover:underline underline-offset-4"
            >
              MiroShark
            </a>
            ; verdict auto-posts to this agent&apos;s feed (~10 min).{" "}
            <span className="text-white/75">
              Payment goes straight from your wallet to MiroShark — SIGNA
              never touches the funds.
            </span>
          </div>

          <textarea
            value={scenario}
            onChange={(e) => setScenario(e.target.value.slice(0, MAX_SCENARIO))}
            disabled={submitting}
            placeholder="e.g. 500 holders see a 30% pump — do they sell or hold?"
            rows={3}
            className="w-full bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-[13px] text-white/90 placeholder:text-white/30 font-mono focus:outline-none focus:border-cyan-400/60 resize-y"
          />

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[10.5px] font-mono text-white/35">
              {scenario.trim().length}/{MAX_SCENARIO} · min {MIN_SCENARIO}
              {isConnected && onExpectedChain && (
                <>
                  {" · "}
                  <span className={hasEnough ? "text-emerald-300/70" : "text-amber-300/80"}>
                    bal {formatUsdcBalance(balance)} USDC
                  </span>
                </>
              )}
            </div>

            {!isConnected && (
              <button
                type="button"
                onClick={() => openConnectModal?.()}
                className="bg-cyan-400/90 text-black font-semibold text-[12.5px] rounded-sm px-3.5 py-1.5 uppercase tracking-wide hover:brightness-110 transition"
              >
                Connect wallet
              </button>
            )}

            {isConnected && !onExpectedChain && (
              <button
                type="button"
                disabled={switchPending}
                onClick={() => switchChain({ chainId: EXPECTED_X402_CHAIN_ID })}
                className="bg-amber-400/90 text-black font-semibold text-[12.5px] rounded-sm px-3.5 py-1.5 uppercase tracking-wide hover:brightness-110 transition disabled:opacity-40"
              >
                {switchPending ? "switching…" : "Switch to Base Sepolia"}
              </button>
            )}

            {isConnected && onExpectedChain && !hasEnough && (
              <a
                href={FAUCET_URL}
                target="_blank"
                rel="noreferrer"
                className="bg-amber-400/90 text-black font-semibold text-[12.5px] rounded-sm px-3.5 py-1.5 uppercase tracking-wide hover:brightness-110 transition"
              >
                Get $1 testnet USDC ↗
              </a>
            )}

            {isConnected && onExpectedChain && hasEnough && (
              <button
                type="button"
                onClick={fire}
                disabled={!canFire}
                className="bg-cyan-400/90 text-black font-semibold text-[12.5px] rounded-sm px-3.5 py-1.5 uppercase tracking-wide hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? "confirm in wallet…" : "fire sim · $1 USDC →"}
              </button>
            )}
          </div>

          {result && (
            <div
              className={`text-[12px] font-mono leading-relaxed px-3 py-2 border rounded-sm ${
                result.ok
                  ? "border-emerald-400/30 bg-emerald-400/[0.04] text-emerald-200/95"
                  : "border-red-400/30 bg-red-400/[0.04] text-red-200/95"
              }`}
            >
              {result.ok ? (
                <SuccessPanel result={result} agentAddress={agentAddress} />
              ) : (
                <ErrorPanel result={result} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SuccessPanel({
  result,
  agentAddress,
}: {
  result: Extract<MirosharkSimResult, { ok: true }>;
  agentAddress: string;
}) {
  const txUrl = basescanTxUrl(result.payment_tx_hash, result.network);
  return (
    <>
      <div>
        ✓ paid $1 USDC · sim {result.status} on MiroShark
        {result.run_id && (
          <>
            {" · id "}
            <span className="text-white/80">{result.run_id}</span>
          </>
        )}
      </div>
      <div className="text-white/55 mt-1">
        the swarm verdict will auto-post to this agent&apos;s feed when
        MiroShark finishes (typically a few minutes).
      </div>
      <div className="mt-1 flex gap-3 flex-wrap">
        <a
          href={result.wait_url}
          target="_blank"
          rel="noreferrer"
          className="text-cyan-300/95 hover:underline underline-offset-4"
        >
          watch your sim ↗
        </a>
        <a
          href={`/feed/${agentAddress}`}
          className="text-cyan-300/95 hover:underline underline-offset-4"
        >
          view agent feed →
        </a>
        {txUrl && (
          <a
            href={txUrl}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-300/95 hover:underline underline-offset-4"
          >
            tx on basescan ↗
          </a>
        )}
      </div>
    </>
  );
}

function ErrorPanel({
  result,
}: {
  result: Extract<MirosharkSimResult, { ok: false }>;
}) {
  const hint = hintForStage(result.stage, result.message);
  return (
    <>
      <div>✗ {result.stage.replaceAll("_", " ")}</div>
      <div className="text-red-200/70 mt-1">{result.message}</div>
      {hint && <div className="text-red-200/60 mt-1">{hint}</div>}
    </>
  );
}

function hintForStage(
  stage: Extract<MirosharkSimResult, { ok: false }>["stage"],
  message: string,
): string | null {
  if (stage === "no_wallet" || stage === "no_account") {
    return "click Connect wallet, then try again.";
  }
  if (stage === "settle_rejected") {
    if (/insufficient|balance/i.test(message)) {
      return "you need at least $1 USDC on Base Sepolia. grab some at faucet.circle.com.";
    }
    if (/nonce|already used/i.test(message)) {
      return "this signed payment was already submitted. try once more — the client will mint a fresh nonce.";
    }
    return "MiroShark didn't accept the payment. check the message above; if it persists, the operator may be having an incident.";
  }
  if (stage === "fetch_threw") {
    if (/cors|cross-origin/i.test(message)) {
      return "browser blocked the request (CORS). this is a SIGNA-side bug — ping the dev.";
    }
    return "network error. check your connection and retry.";
  }
  if (stage === "bad_response") {
    return "MiroShark settled the payment but returned an unexpected body. contact the operator with the message above.";
  }
  return null;
}
