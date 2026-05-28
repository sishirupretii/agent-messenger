import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { SearchClient } from "./SearchClient";

const TITLE = "Search · SIGNA";
const DESCRIPTION =
  "Search every wallet-signed room and message on the SIGNA network. By room name, slug, sender wallet, or body text.";
const URL = "https://www.signaagent.xyz/search";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: URL,
    siteName: "SIGNA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  alternates: { canonical: URL },
};

export default function SearchPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-16 pb-8">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-4">
              search · live · wallet-signed only
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-medium tracking-[-0.025em] leading-[1.0]">
              Search the SIGNA network.
            </h1>
            <p className="mt-4 text-[14.5px] text-white/65 leading-relaxed max-w-xl">
              Type a token symbol, a room slug, a wallet address, or a phrase.
              Hits come from every public room and every wallet-signed message.
            </p>
          </div>
        </section>
        <section>
          <div className="max-w-3xl mx-auto px-6 lg:px-10 py-8">
            <SearchClient />
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
