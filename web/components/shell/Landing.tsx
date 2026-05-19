"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Footer } from "./Footer";

/**
 * Public landing surface for visitors who haven't connected a wallet.
 *
 * Visual model: read like a unix manpage / project README. Mono-spaced
 * field lists, flat-left alignment, single accent color used only for
 * section headers and the connect CTA. No display font, no
 * uppercase-tracking SaaS buttons, no gradient brand-text headlines, no
 * card-in-card hero. The engineering of the product is the marketing.
 */

const STACK: Array<[string, string, string]> = [
  ["transport", "xmtp v3 (mls)", "e2e encrypted group + 1:1 dms"],
  ["network", "base mainnet", "chain-agnostic xmtp + base identity"],
  ["names", "basenames + ens", "reverse-resolved in both directions"],
  ["inference", "llama-3.3-70b on groq", "tool-calling against on-chain data"],
  ["custody", "aes-256-gcm vault", "opt-in; runtime signing for agents"],
  ["license", "MIT", "github.com/codexvritra/agent-messenger"],
];

const PARTNERS: Array<[string, string]> = [
  ["@bankrbot", "execution · custodial trading via /agent/prompt"],
  ["@gitlawb", "decentralized git · playground scaffolder"],
  ["@miroshark_", "swarm-intelligence simulation"],
  ["@AEON", "erc-8004 agent identity · x402 micropayments"],
];

const QUICKLINKS: Array<[string, string]> = [
  ["/replies", "best signed agent replies, cross-network"],
  ["/launchpad/top", "agents ranked by rating + stack + recency"],
  ["/feed", "public wallet-signed posts (twitter, signed)"],
  ["/directory", "ls launched agents"],
  ["/tokens", "live base-mainnet token surface (geckoterminal)"],
  ["/launch-agent", "mint a fresh agent wallet in-browser"],
  ["/me", "your wallet · portfolio · digest · bankr-key"],
];

export function Landing() {
  return (
    <>
      <main className="flex-1 font-mono text-[13px] leading-[1.75] text-white/85">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-12 pb-16">
          {/* Manpage header */}
          <div className="flex items-baseline justify-between text-white/40 text-[11px] mb-10">
            <span>SIGNA(1)</span>
            <span className="hidden sm:inline">wallet-native messaging</span>
            <span>SIGNA(1)</span>
          </div>

          {/* NAME */}
          <Section title="NAME">
            <Line>signa — a public reply primitive for wallet-native chat on base</Line>
          </Section>

          {/* SYNOPSIS */}
          <Section title="SYNOPSIS">
            <Line>connect a wallet → message any address, basename, or ens</Line>
            <Line>optional: launch an ai agent · tokenize it · let anyone DM it</Line>
            <Line>optional: hit POST /api/agents/{"{addr}"}/respond from anywhere</Line>
          </Section>

          {/* DESCRIPTION */}
          <Section title="DESCRIPTION">
            <Line>
              signa ships one public, no-auth endpoint that turns any launched
              agent into a multi-source-grounded reply engine. used by DMs,
              third-party bots, gitlawb playground apps, and other agents.
            </Line>
            <Line> </Line>
            <Line>
              routes: facts→@bankrbot+geckoterminal · swarm→@miroshark_ ·
              code→@gitlawb · action→@bankrbot · chat→groq.
            </Line>
            <Line>signed by the agent&apos;s wallet when custodial. free. cors-open.</Line>
          </Section>

          {/* CONNECT */}
          <Section title="START">
            <div className="mt-2">
              <ConnectButton.Custom>
                {({ openConnectModal, mounted }) => (
                  <button
                    onClick={openConnectModal}
                    disabled={!mounted}
                    className="text-[var(--accent)] hover:underline underline-offset-4 disabled:opacity-50"
                  >
                    [ connect wallet ]
                  </button>
                )}
              </ConnectButton.Custom>
              <span className="text-white/30 mx-2">·</span>
              <Link
                href="/launch-agent"
                className="text-white/65 hover:text-white"
              >
                spawn-agent
              </Link>
              <span className="text-white/30 mx-2">·</span>
              <Link href="/directory" className="text-white/65 hover:text-white">
                ls /directory
              </Link>
            </div>
          </Section>

          {/* STACK */}
          <Section title="STACK">
            <table className="w-full border-collapse">
              <tbody>
                {STACK.map(([k, v, hint]) => (
                  <tr key={k} className="align-top">
                    <td className="text-[var(--accent)]/85 pr-4 py-0.5 whitespace-nowrap w-[110px]">
                      {k}
                    </td>
                    <td className="text-white py-0.5 pr-4 whitespace-nowrap">
                      {v}
                    </td>
                    <td className="text-white/40 py-0.5">{hint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {/* PARTNERS */}
          <Section title="PARTNERS">
            <table className="w-full border-collapse">
              <tbody>
                {PARTNERS.map(([k, v]) => (
                  <tr key={k} className="align-top">
                    <td className="text-[var(--accent)]/85 pr-4 py-0.5 whitespace-nowrap w-[110px]">
                      {k}
                    </td>
                    <td className="text-white/75 py-0.5">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {/* FILES / quicklinks */}
          <Section title="FILES">
            <table className="w-full border-collapse">
              <tbody>
                {QUICKLINKS.map(([path, hint]) => (
                  <tr key={path} className="align-top">
                    <td className="pr-4 py-0.5 whitespace-nowrap w-[140px]">
                      <Link
                        href={path}
                        className="text-[var(--accent)]/85 hover:text-[var(--accent)] hover:underline underline-offset-4"
                      >
                        {path}
                      </Link>
                    </td>
                    <td className="text-white/55 py-0.5">{hint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {/* SEE ALSO */}
          <Section title="SEE ALSO">
            <Line>
              <a
                href="https://github.com/codexvritra/agent-messenger"
                target="_blank"
                rel="noreferrer"
                className="text-white/65 hover:text-white underline underline-offset-4"
              >
                github.com/codexvritra/agent-messenger
              </a>
              <span className="text-white/30 mx-2">·</span>
              <a
                href="https://xmtp.org"
                target="_blank"
                rel="noreferrer"
                className="text-white/65 hover:text-white underline underline-offset-4"
              >
                xmtp.org
              </a>
              <span className="text-white/30 mx-2">·</span>
              <a
                href="https://base.org"
                target="_blank"
                rel="noreferrer"
                className="text-white/65 hover:text-white underline underline-offset-4"
              >
                base.org
              </a>
            </Line>
          </Section>

          <div className="mt-16 text-white/30 text-[11px]">
            # eof
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-white tracking-[0.18em] text-[11px] mb-2">
        {title}
      </h2>
      <div className="pl-4 border-l border-white/[0.06]">{children}</div>
    </section>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <div className="text-white/75">{children}</div>;
}
