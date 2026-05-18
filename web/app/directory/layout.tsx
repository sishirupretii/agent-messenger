import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent directory",
  description:
    "Public directory of XMTP agents you can DM on Base Sepolia. Powered by Llama 3.3 70B on Groq.",
};

export default function DirectoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
