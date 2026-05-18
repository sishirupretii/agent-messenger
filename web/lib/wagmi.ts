import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, mainnet } from "wagmi/chains";
import { http } from "wagmi";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

if (!projectId) {
  throw new Error(
    "Missing NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID — add it in Vercel project settings (Environment Variables).",
  );
}

export const wagmiConfig = getDefaultConfig({
  appName: "Agent Messenger",
  projectId,
  // baseSepolia for the app, mainnet for ENS resolution only (not a default switch target).
  chains: [baseSepolia, mainnet],
  transports: {
    [baseSepolia.id]: http(),
    [mainnet.id]: http(),
  },
  ssr: true,
});
