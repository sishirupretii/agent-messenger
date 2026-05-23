import { base, baseSepolia, mainnet } from "wagmi/chains";
import {
  createConfig,
  http,
  cookieStorage,
  createStorage,
} from "wagmi";
import { injected } from "wagmi/connectors";

/**
 * SIGNA wagmi config — SERVER-SAFE.
 *
 * This module is imported from the root layout (server component) for
 * `cookieToInitialState(wagmiConfig, cookieString)`, which hydrates
 * wallet state from the wagmi.store cookie at SSR time. To stay
 * server-safe we use ONLY wagmi's primitive `injected` connector —
 * no RainbowKit, no browser-only APIs.
 *
 * The actual client-side WagmiProvider uses `clientWagmiConfig` from
 * `lib/wagmi-client.ts`, which adds RainbowKit's full wallet roster
 * (Coinbase, MetaMask, Rainbow, Trust, Phantom, OKX, Brave, Ledger,
 * WalletConnect, plus injected) for mobile deep-links and broad
 * wallet support.
 *
 * Why two configs:
 *   RainbowKit's `connectorsForWallets()` runs wallet-detection
 *   browser code at import time, so it cannot be imported into a
 *   server component. Wagmi itself supports the split — the
 *   chain state in the cookie is interoperable between configs
 *   that share the same `chains` array.
 */
export const wagmiConfig = createConfig({
  // base = primary app chain (real ETH, real txs).
  // baseSepolia = MiroShark x402 endpoint (testnet today; flips to mainnet when Aaron switches his Railway env).
  // mainnet = ENS reverse + Basenames (via ENSIP-19 coinType) read from base too.
  chains: [base, baseSepolia, mainnet],
  connectors: [injected({ shimDisconnect: true })],
  // Explicit CORS-friendly public RPCs. viem's default `http()` with no
  // arg picks an upstream from a rotating list of public endpoints
  // (eth.merkle.io et al) — most don't allow CORS from arbitrary
  // origins, so wagmi's background chain probing throws CORS errors in
  // every visitor's devtools. Harmless functionally (real reads go via
  // the user's wallet provider), but it clutters logs and looks like
  // a bug to anyone who peeks at the console.
  transports: {
    [base.id]: http("https://mainnet.base.org"),
    [baseSepolia.id]: http("https://sepolia.base.org"),
    [mainnet.id]: http("https://cloudflare-eth.com"),
  },
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});

// NOTE: the wagmi `Register` module declaration is in lib/wagmi-client.ts
// so it's bound to the RUNTIME config (clientWagmiConfig), not this
// server-only shim. wagmi hooks (useAccount, useSendTransaction, etc.)
// are typed against the client config's chains + connectors.
