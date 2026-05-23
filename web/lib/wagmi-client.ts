"use client";

import { base, baseSepolia, mainnet } from "wagmi/chains";
import {
  createConfig,
  http,
  cookieStorage,
  createStorage,
} from "wagmi";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
  trustWallet,
  phantomWallet,
  injectedWallet,
  braveWallet,
  okxWallet,
  ledgerWallet,
} from "@rainbow-me/rainbowkit/wallets";

/**
 * CLIENT-ONLY wagmi config with the full RainbowKit wallet roster.
 *
 * Mobile UX fix (May 2026): users reported "Connect Wallet not
 * working" because the previous server-safe config only surfaced 4
 * connectors and many mobile wallets (Trust, Rainbow, Phantom, OKX,
 * Backpack…) only deep-link reliably via RainbowKit's per-wallet
 * connectors.
 *
 * IMPORTANT: NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must be set in
 * Vercel env for mobile wallets that route through WalletConnect
 * (Trust, Rainbow, Phantom, Backpack, OKX). Without it those wallets
 * can't generate the QR/deep-link and RainbowKit falls back to its
 * "Get a Wallet" install screen — which is exactly what the user
 * reported. Set it in Vercel → Settings → Environment Variables.
 *
 * Why this is a separate file from `lib/wagmi.ts`:
 *   `connectorsForWallets()` from RainbowKit runs wallet-detection
 *   browser code at import time, so it cannot live in a module that
 *   gets imported by server components. The root layout calls
 *   `cookieToInitialState(serverWagmiConfig, …)` on the server using
 *   `lib/wagmi.ts`. The client provider uses THIS config for the
 *   actual WagmiProvider runtime.
 *
 *   Both configs share the same `chains` + `transports` + `ssr: true`
 *   + `cookieStorage`, so the chain state in the cookie hydrates
 *   correctly across the boundary. The connector identity may differ
 *   on the very first client mount after a server-side reconnect,
 *   but wagmi auto-recovers within one render cycle.
 */

// Trim is critical here: the Vercel env value for NEXT_PUBLIC_
// WALLETCONNECT_PROJECT_ID came in with a trailing newline at some
// point, and web3modal's config API URL-encodes it as `%0A` then
// rejects the request with HTTP 403. The visible symptom was mobile
// wallets failing to deep-link with no clear error. Cheap insurance.
const projectId = (
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ??
  "MISSING_WALLETCONNECT_PROJECT_ID"
).trim();

if (projectId === "MISSING_WALLETCONNECT_PROJECT_ID") {
  // eslint-disable-next-line no-console
  console.warn(
    "[wagmi-client] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set — " +
      "mobile wallets that route through WalletConnect (Trust, Rainbow, " +
      "Phantom, Backpack, OKX, etc.) will not deep-link. Set the env " +
      "var in Vercel and redeploy.",
  );
}

const connectors = connectorsForWallets(
  [
    {
      groupName: "Popular",
      wallets: [
        coinbaseWallet, // mobile SDK + desktop extension — works without setup
        metaMaskWallet, // mobile deep-link + desktop extension
        rainbowWallet, // mobile deep-link
        walletConnectWallet, // universal QR/deep-link
      ],
    },
    {
      groupName: "Other",
      wallets: [
        trustWallet,
        phantomWallet,
        okxWallet,
        braveWallet,
        ledgerWallet,
        injectedWallet,
      ],
    },
  ],
  {
    appName: "SIGNA",
    appDescription:
      "Wallet-native messaging on Base. Spawn agents, chat, tip.",
    appUrl: "https://www.signaagent.xyz",
    appIcon: "https://www.signaagent.xyz/icon.png",
    projectId,
  },
);

export const clientWagmiConfig = createConfig({
  chains: [base, baseSepolia, mainnet],
  connectors,
  // Explicit CORS-friendly public RPCs — see the comment in `lib/wagmi.ts`.
  // Defaulting to viem's `http()` with no arg falls into a rotating
  // public-RPC list (eth.merkle.io et al) that doesn't allow CORS from
  // browser origins, polluting devtools with CORS errors that look
  // like bugs.
  transports: {
    [base.id]: http("https://mainnet.base.org"),
    [baseSepolia.id]: http("https://sepolia.base.org"),
    [mainnet.id]: http("https://cloudflare-eth.com"),
  },
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});

// Register the wagmi config the runtime actually uses, so hook types
// (useAccount, useSendTransaction, etc.) infer the right chains +
// connectors. This is the RUNTIME config — the server-only one in
// lib/wagmi.ts only exists for `cookieToInitialState` chain decode.
declare module "wagmi" {
  interface Register {
    config: typeof clientWagmiConfig;
  }
}
