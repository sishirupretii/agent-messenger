import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ecosystem",
  description:
    "SIGNA integrates with Bankr (trading), AEON (payments), gitlawb (decentralized git for agents), and MiroShark (agent simulation). All native to Base.",
};

export default function EcosystemLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
