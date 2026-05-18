import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, baseSepolia, mainnet } from "wagmi/chains";
import { http } from "wagmi";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

if (!projectId) {
  throw new Error(
    "Missing NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID — add it in Vercel project settings (Environment Variables).",
  );
}

export const wagmiConfig = getDefaultConfig({
  appName: "SIGNA",
  projectId,
  // baseSepolia primary (where the app runs).
  // mainnet for ENS resolution; base mainnet for Basenames resolution (ENSIP-19).
  chains: [baseSepolia, base, mainnet],
  transports: {
    [baseSepolia.id]: http(),
    [base.id]: http(),
    [mainnet.id]: http(),
  },
  ssr: true,
});
