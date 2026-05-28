import { notFound } from "next/navigation";
import { aeonAgentRegistration } from "@/lib/skills/aeon";
import { AeonHandshakeClient } from "../AeonHandshakeClient";

/**
 * /handshake/aeon/[tokenId]/embed
 *
 * iframe-friendly version of the ERC-8004 handshake form. Strips the
 * AppHeader + Footer + hero copy so partners can drop the wallet-signed
 * DM box onto their site with one tag:
 *
 *   <iframe
 *     src="https://www.signaagent.xyz/handshake/aeon/<tokenId>/embed"
 *     style="width:100%;height:520px;border:0;border-radius:8px"
 *     allow="clipboard-write"
 *     sandbox="allow-scripts allow-same-origin allow-popups allow-forms
 *              allow-popups-to-escape-sandbox"></iframe>
 *
 * Pulls the same on-chain registration data as the full page and
 * pre-fills the same wallet-signed agent_dm body.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tokenId: string }>;
}) {
  const { tokenId } = await params;
  return {
    title: `Aeon handshake embed · #${tokenId}`,
    robots: { index: false, follow: false },
  };
}

export default async function AeonHandshakeEmbedPage({
  params,
}: {
  params: Promise<{ tokenId: string }>;
}) {
  const { tokenId } = await params;
  if (!/^\d+$/.test(tokenId)) notFound();

  const reg = await aeonAgentRegistration(BigInt(tokenId), "mainnet");
  if (!reg) notFound();

  const r = reg.registration ?? {};

  const handshakeTemplate = [
    `gm. handshake from a SIGNA wallet.`,
    ``,
    `you are registered as ERC-8004 agent #${tokenId}`,
    `on the Aeon Identity Registry (Ethereum mainnet).`,
    `i'm reaching you through your on-chain owner wallet.`,
    ``,
    `signed end to end. reply via SIGNA inbox or your own bridge.`,
  ].join("\n");

  return (
    <div className="min-h-screen bg-[var(--background)] p-4">
      <div className="max-w-md mx-auto space-y-3">
        <div className="border border-white/10 rounded-sm bg-white/[0.02] p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300 mb-1">
            aeon · erc-8004 · #{tokenId}
          </div>
          <div className="font-display text-[18px] font-medium tracking-[-0.01em] leading-tight">
            {r.name ?? `Agent #${tokenId}`}
          </div>
          <div className="text-[11.5px] font-mono text-white/45 mt-1 break-all">
            owner: {reg.owner}
          </div>
        </div>
        <AeonHandshakeClient
          tokenId={tokenId}
          recipient={reg.owner}
          defaultBody={handshakeTemplate}
        />
        <div className="text-[10.5px] text-white/30 text-center pt-1">
          powered by{" "}
          <a
            href="https://www.signaagent.xyz"
            target="_blank"
            rel="noreferrer"
            className="text-white/50 hover:text-white"
          >
            signaagent.xyz
          </a>
        </div>
      </div>
    </div>
  );
}
