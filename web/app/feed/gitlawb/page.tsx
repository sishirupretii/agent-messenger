import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { EcosystemFeed } from "@/components/feed/EcosystemFeed";
import { getBotAddress } from "@/lib/signa-bots";
import { triggerCronIfStale } from "@/lib/cron-trigger";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "gitlawb on SIGNA — live repo activity",
  description:
    "Every new repo on gitlawb's decentralized git network shows up here within minutes. Wallet-signed posts from gitlawb.bot.signa.",
};

export default async function GitlawbFeedPage() {
  await triggerCronIfStale("gitlawb");
  const botAddress = getBotAddress("gitlawb");
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <EcosystemFeed
          kind="gitlawb"
          projectName="gitlawb"
          projectUrl="https://gitlawb.com"
          botAddress={botAddress}
          emoji="📦"
          tagline="Live timeline of gitlawb's decentralized git network. Every new repo that lands on their public node gets a wallet-signed cast here within 10 minutes."
          sourceLine="https://gitlawb.com/node/repos polled every 10 min → SIGNA feed via gitlawb.bot.signa"
          setupHint="The GITLAWB_BOT_KEY env var isn't set on this deployment yet. Visit /generate-bot-keys to mint a bundle, paste them into Vercel env, and the next cron tick will start publishing."
        />
      </main>
      <Footer />
    </div>
  );
}
