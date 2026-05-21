"use client";

import { ReactNode, useState } from "react";
import { WagmiProvider, type State } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { base } from "wagmi/chains";
// CLIENT config — has the full RainbowKit wallet roster (Coinbase,
// MetaMask, Rainbow, Trust, Phantom, OKX, Brave, Ledger, WalletConnect,
// Injected). The server-side `wagmiConfig` (from lib/wagmi.ts) is used
// only in the root layout for `cookieToInitialState` chain decode.
import { clientWagmiConfig } from "@/lib/wagmi-client";
import { ChatProvider } from "@/context/ChatProvider";

/**
 * `initialState` is read server-side from the `wagmi.store` cookie via
 * `cookieToInitialState` in the root layout, then passed in here so the
 * WagmiProvider hydrates with the previously-connected wallet on every
 * server-rendered route. Without this, dynamic routes like /feed/bankr
 * appeared to "disconnect" the wallet on navigation because the provider
 * mounted empty and had to wait for auto-reconnect.
 */
export function Providers({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: State;
}) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={clientWagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#ffffff",
            accentColorForeground: "#000000",
            borderRadius: "small",
            overlayBlur: "small",
          })}
          initialChain={base.id}
        >
          <ChatProvider>{children}</ChatProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
