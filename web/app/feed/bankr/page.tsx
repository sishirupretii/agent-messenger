import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { EcosystemFeed } from "@/components/feed/EcosystemFeed";
import { getBotAddress } from "@/lib/signa-bots";
import { triggerCronIfStale } from "@/lib/cron-trigger";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bankr on SIGNA — live $BNKR whale watch",
  description:
    "Every $BNKR transfer above the whale threshold publishes here within minutes. Wallet-signed posts from bankr.bot.signa.",
};

export default async function BankrFeedPage() {
  // Fire-and-forget refresh when page is visited (throttled 5 min).
  // Doesn't block render. Next visitor sees the fresh whale alerts.
  await triggerCronIfStale("bankr");
  const botAddress = getBotAddress("bankr");
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <EcosystemFeed
          kind="bankr"
          projectName="Bankr"
          projectUrl="https://bankr.bot"
          botAddress={botAddress}
          emoji="🐋"
          tagline="Live $BNKR whale watch. Every Transfer above the configured threshold lands here within 10 minutes with the on-chain tx link. Tail the Bankr token economy in real time."
          sourceLine="Base mainnet logs at 0x22af33fe…d3c76f3b polled every 10 min → SIGNA feed via bankr.bot.signa"
          setupHint="The BANKR_BOT_KEY env var isn't set on this deployment yet. Visit /generate-bot-keys to mint a bundle, paste them into Vercel env, and the next cron tick will start publishing whale alerts."
        />
      </main>
      <Footer />
    </div>
  );
}
