/**
 * verify-x402-sepolia.mjs
 *
 * Headless end-to-end verification of the v0.26 visitor-pays x402 flow
 * against Aaron's live MiroShark Sepolia endpoint. The Node test wallet
 * stands in for what a browser wallet would do — same @x402/fetch +
 * @x402/evm SDK calls, same signTypedData adapter pattern, same target
 * URL, just a LocalAccount as the signer instead of a viem WalletClient
 * bound to MetaMask.
 *
 * What this proves if it succeeds:
 *   - the SDK pair (@x402/fetch + @x402/evm) talks to Aaron's server
 *     on Base Sepolia
 *   - the 402 challenge → sign → retry → 202 dance settles
 *   - the response carries a real on-chain tx + a valid wait_url
 *
 * What it CAN'T prove (still needs a browser test for full sign-off):
 *   - RainbowKit connect modal opens correctly
 *   - wagmi useSwitchChain prompts the network swap
 *   - the wallet UI surfaces a clean EIP-712 popup
 *
 * Usage (from web/):
 *
 *   $env:X402_BUYER_PRIVATE_KEY = "0x..."
 *   node scripts/verify-x402-sepolia.mjs
 *
 * Cost: $1 USDC on Base Sepolia (testnet, free from faucet.circle.com).
 */

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, publicActions } from "viem";
import { baseSepolia } from "viem/chains";

const MIROSHARK_X402_URL =
  process.env.MIROSHARK_X402_URL ||
  "https://miroshark-x402-production.up.railway.app/x402/run";

const TEST_PROMPT =
  "v0.26 verification fire — 500 holders see a 30% pump on a small-cap meme token. do they sell or hold?";

function fail(stage, message, extra) {
  console.error(`\n❌  FAILED at stage: ${stage}`);
  console.error(`    message: ${message}`);
  if (extra) console.error(`    extra:   ${JSON.stringify(extra, null, 2)}`);
  process.exit(1);
}

function decodeBase64Json(b64) {
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const rawKey = process.env.X402_BUYER_PRIVATE_KEY;
  if (!rawKey) {
    fail(
      "env",
      "X402_BUYER_PRIVATE_KEY is not set. set it in your shell and re-run.",
    );
  }
  const pk = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
    fail("env", "X402_BUYER_PRIVATE_KEY is set but not a valid 0x-prefixed 64-hex private key");
  }

  console.log("→  building test wallet on Base Sepolia (eip155:84532)…");
  const account = privateKeyToAccount(pk);
  console.log(`   address: ${account.address}`);

  // Mirror the browser path: build a viem WalletClient (the browser
  // version uses wagmi's useWalletClient(); here we construct one
  // directly from the LocalAccount). The signer adapter below is
  // byte-for-byte the same shape as web/lib/x402-client.ts.
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  }).extend(publicActions);

  console.log("→  building x402 client + registering exact eip155 scheme…");
  const client = new x402Client();
  const signer = {
    address: account.address,
    async signTypedData(msg) {
      return walletClient.signTypedData({
        account,
        domain: msg.domain,
        types: msg.types,
        primaryType: msg.primaryType,
        message: msg.message,
      });
    },
  };
  registerExactEvmScheme(client, { signer });

  const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, client);

  console.log(`→  POST ${MIROSHARK_X402_URL}`);
  console.log(`   prompt: ${TEST_PROMPT}`);
  console.log("→  expect: 402 challenge → sign → retry → 202 with run_id\n");

  let res;
  try {
    res = await fetchWithPayment(MIROSHARK_X402_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: TEST_PROMPT }),
    });
  } catch (e) {
    fail("fetch_threw", e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch {}
    fail("settle_rejected", `HTTP ${res.status}`, {
      status: res.status,
      body: text.slice(0, 500),
    });
  }

  let txHash = null;
  let network = "eip155:84532";
  const respHeader = res.headers.get("payment-response");
  if (respHeader) {
    const settle = decodeBase64Json(respHeader);
    if (settle?.transaction) txHash = settle.transaction;
    if (settle?.network) network = settle.network;
  }

  let bodyJson;
  try {
    bodyJson = await res.json();
  } catch {
    fail("bad_response", "settle returned 2xx but body was not valid JSON");
  }
  const inner = bodyJson?.data ?? {};
  const run_id = String(inner.run_id ?? "");
  const wait_url = String(inner.wait_url ?? "");
  if (!run_id || !wait_url) {
    fail("bad_response", "missing run_id / wait_url", bodyJson);
  }

  const basescan =
    network === "eip155:84532"
      ? `https://sepolia.basescan.org/tx/${txHash}`
      : network === "eip155:8453"
        ? `https://basescan.org/tx/${txHash}`
        : null;

  console.log("\n✅  SUCCESS — visitor-pays x402 flow works against Aaron's Sepolia endpoint.\n");
  console.log(`    network:       ${network}`);
  console.log(`    payer:         ${account.address}`);
  console.log(`    run_id:        ${run_id}`);
  console.log(`    status:        ${inner.status ?? "queued"}`);
  console.log(`    tx_hash:       ${txHash ?? "(not in PAYMENT-RESPONSE header)"}`);
  if (basescan) console.log(`    basescan:      ${basescan}`);
  console.log(`    wait_url:      ${wait_url}`);
  if (inner.status_url) console.log(`    status_url:    ${inner.status_url}`);
  console.log("");
  console.log("Open the wait_url in a browser to watch MiroShark process the run.");
  console.log("In ~10 min, /feed/miroshark on signaagent.xyz should get the verdict post via Aaron's webhook.");
}

main().catch((e) => {
  console.error("\n❌  unexpected error:");
  console.error(e);
  process.exit(1);
});
