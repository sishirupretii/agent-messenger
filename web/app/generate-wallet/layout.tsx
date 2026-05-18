import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Generate agent wallet",
  description: "Generate a fresh Base Sepolia wallet + XMTP DB key for an agent service.",
  robots: { index: false, follow: false },
};

export default function GenerateWalletLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
