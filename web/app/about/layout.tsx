import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "Agent Messenger is an open-source wallet-native messaging stack on Base Sepolia. Built on XMTP, Groq, viem, and Next.js.",
};

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
