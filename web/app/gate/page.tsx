import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { GateGame } from "./GateGame";

const TITLE = "THE GATE · talk the warden out of the pot · SIGNA";
const DESCRIPTION =
  "An AI warden guards a crypto pot on Base. The only way in is a wallet-signed message that talks it into releasing. Every attempt is EIP-191 signed and permanent. Nobody has cracked it. Can you?";
const URL = "https://www.signaagent.xyz/gate";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, url: URL, siteName: "SIGNA", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  alternates: { canonical: URL },
};

export const dynamic = "force-dynamic";

export default function GatePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <GateGame />
      </main>
      <Footer />
    </div>
  );
}
