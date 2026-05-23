"use client";

/**
 * Browser-side x402 v2 client for the public "Run a sim" button.
 *
 * v0.26.1 (chain-agnostic): the network / asset / payTo are no longer
 * hardcoded — we probe `/api/x402/info` (which in turn issues a no-
 * payment POST to Aaron's MiroShark endpoint and parses the 402
 * challenge header) and the UI follows whatever Aaron is currently
 * serving. When he flips his Railway env from Sepolia to mainnet, the
 * probe returns `eip155:8453` and visitors auto-prompt-switch to Base
 * mainnet on their next page view — zero code change on our side.
 *
 * The signer is still the visitor's connected wallet (wagmi
 * WalletClient adapted to x402's ClientEvmSigner). SIGNA never holds
 * a buyer key.
 */

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { WalletClient, Account } from "viem";

export const MIROSHARK_X402_URL =
  process.env.NEXT_PUBLIC_MIROSHARK_X402_URL ||
  "https://miroshark-x402-production.up.railway.app/x402/run";

/**
 * Shape returned by `GET /api/x402/info`. The route always responds
 * with `ok: true` — on probe failure it falls back to Base Sepolia
 * defaults so the UI keeps working.
 */
export type X402Info = {
  ok: true;
  network: string;
  chain_id: number;
  asset: `0x${string}`;
  pay_to: `0x${string}`;
  amount: string;
  chain_label: string;
  faucet_url: string | null;
  onramp_url: string | null;
  probed_at: string;
  source: "probe" | string;
};

export async function fetchX402Info(): Promise<X402Info | null> {
  try {
    const res = await fetch("/api/x402/info", {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as X402Info;
    if (!json.ok) return null;
    return json;
  } catch {
    return null;
  }
}

export type MirosharkSimResult =
  | {
      ok: true;
      run_id: string;
      status: string;
      wait_url: string;
      status_url?: string;
      payer?: string;
      payment_tx_hash: `0x${string}` | null;
      network: string;
      amount_paid: string;
    }
  | {
      ok: false;
      stage:
        | "no_wallet"
        | "no_account"
        | "client_setup"
        | "fetch_threw"
        | "settle_rejected"
        | "bad_response";
      message: string;
      status?: number;
    };

function decodeBase64Json<T>(b64: string): T | null {
  try {
    const decoded =
      typeof atob !== "undefined"
        ? atob(b64)
        : Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

/**
 * Pay + fire a MiroShark sim using the visitor's connected wallet.
 *
 * `walletClient` comes from wagmi's `useWalletClient()` hook. We adapt
 * it to x402's signer interface — only `address` + `signTypedData` are
 * required. The signTypedData call surfaces in the user's wallet UI
 * (MetaMask popup, Coinbase Wallet sheet, WalletConnect deep-link).
 *
 * The x402 client doesn't care which network Aaron is serving — the
 * server-side 402 challenge dictates network/asset/payTo, and the
 * registered scheme matches via wildcard `eip155:*`. Our role is just
 * to make sure the visitor's wallet is on the right chain when this
 * runs — that's RunSimButton's job, driven by the probe info.
 */
export async function fireMirosharkSim(args: {
  walletClient: WalletClient | null | undefined;
  prompt: string;
  agentAddress?: string;
  agentDid?: string;
}): Promise<MirosharkSimResult> {
  const { walletClient, prompt, agentAddress, agentDid } = args;

  if (!walletClient) {
    return {
      ok: false,
      stage: "no_wallet",
      message: "wallet not connected",
    };
  }
  const account = walletClient.account as Account | undefined;
  if (!account) {
    return {
      ok: false,
      stage: "no_account",
      message: "wallet client has no active account",
    };
  }

  type LooseSignTypedData = (args: {
    account: Account;
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<`0x${string}`>;

  let fetchWithPayment: ReturnType<typeof wrapFetchWithPayment>;
  try {
    const client = new x402Client();
    const signer = {
      address: account.address as `0x${string}`,
      async signTypedData(msg: {
        domain: Record<string, unknown>;
        types: Record<string, unknown>;
        primaryType: string;
        message: Record<string, unknown>;
      }): Promise<`0x${string}`> {
        const signTypedDataLoose =
          walletClient.signTypedData as unknown as LooseSignTypedData;
        return signTypedDataLoose({ account, ...msg });
      },
    };
    registerExactEvmScheme(client, { signer });
    fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, client);
  } catch (e) {
    return {
      ok: false,
      stage: "client_setup",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const body: Record<string, unknown> = { prompt };
  if (agentAddress) body.agent_address = agentAddress;
  if (agentDid) body.agent_did = agentDid;

  let res: Response;
  try {
    res = await fetchWithPayment(MIROSHARK_X402_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      stage: "fetch_threw",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch {
      // ignore
    }
    return {
      ok: false,
      stage: "settle_rejected",
      status: res.status,
      message: `server rejected the signed payment (HTTP ${res.status}): ${text.slice(0, 280)}`,
    };
  }

  let txHash: `0x${string}` | null = null;
  let network = "eip155:84532";
  const respHeader = res.headers.get("payment-response");
  if (respHeader) {
    const settle = decodeBase64Json<{
      transaction?: `0x${string}`;
      network?: string;
    }>(respHeader);
    if (settle?.transaction) txHash = settle.transaction;
    if (settle?.network) network = settle.network;
  }

  let bodyJson: { success?: boolean; data?: Record<string, unknown> } | null;
  try {
    bodyJson = (await res.json()) as {
      success?: boolean;
      data?: Record<string, unknown>;
    };
  } catch {
    return {
      ok: false,
      stage: "bad_response",
      message: "settle returned 2xx but body was not valid JSON",
    };
  }

  const inner = bodyJson?.data ?? {};
  const run_id = String(inner.run_id ?? "");
  const wait_url = String(inner.wait_url ?? "");
  if (!run_id || !wait_url) {
    return {
      ok: false,
      stage: "bad_response",
      message: `server settled but didn't return run_id / wait_url. body: ${JSON.stringify(bodyJson).slice(0, 280)}`,
    };
  }

  return {
    ok: true,
    run_id,
    status: String(inner.status ?? "queued"),
    wait_url,
    status_url: inner.status_url ? String(inner.status_url) : undefined,
    payer: inner.payer ? String(inner.payer) : undefined,
    payment_tx_hash: txHash,
    network,
    amount_paid: "1000000",
  };
}

/**
 * Minimal ERC-20 ABI for the balance pre-flight check.
 */
export const USDC_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address", name: "account" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** $1 USDC base units (6 decimals). */
export const SIM_PRICE_BASE_UNITS = 1_000_000n;

export function formatUsdcBalance(bal: bigint): string {
  const dollars = Number(bal) / 1_000_000;
  return dollars.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** basescan URL for the settlement tx, on whichever network we landed on. */
export function basescanTxUrl(
  txHash: `0x${string}` | null,
  network: string,
): string | null {
  if (!txHash) return null;
  if (network === "eip155:84532") {
    return `https://sepolia.basescan.org/tx/${txHash}`;
  }
  if (network === "eip155:8453") {
    return `https://basescan.org/tx/${txHash}`;
  }
  return null;
}
