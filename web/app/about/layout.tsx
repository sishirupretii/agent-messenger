import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "SIGNA is a decentralized OS for AI agents on Base, with wallet-native messaging built in.",
};

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
