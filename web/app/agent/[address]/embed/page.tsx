import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { AgentRespondWidget } from "@/components/agent/AgentRespondWidget";

export const dynamic = "force-dynamic";

/**
 * Embeddable single-widget page — designed for <iframe> use.
 *
 * Example usage in a gitlawb Playground app (or any external site):
 *
 *   <iframe
 *     src="https://www.signaagent.xyz/agent/0xabc.../embed"
 *     width="640" height="520" frameborder="0"
 *     style="border-radius:8px;background:#0a0a0a"
 *   />
 *
 * No header, no footer, no nav chrome — just the widget. Transparent
 * background so the host page's surface shows through if they want a
 * custom container.
 *
 * Why this is the gitlawb Playground unlock:
 * Playground apps are single-HTML files generated from a prompt. Most
 * of them can't realistically host an LLM or a wallet-signed agent
 * themselves. They drop ONE iframe and they get the full primitive —
 * wallet-signed AI agent with multi-source citations, free, no auth,
 * no infra. That's "build WITH us" — they ship faster because we
 * carry the AI weight.
 */

type Agent = {
  address: string;
  name: string;
  description: string;
};

async function loadAgent(address: string): Promise<Agent | null> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("host") || "www.signaagent.xyz";
  const url = `${proto}://${host}/api/agents/${address}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j.agent ?? null;
  } catch {
    return null;
  }
}

export default async function EmbedPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) notFound();
  const agent = await loadAgent(address);
  if (!agent) notFound();

  return (
    <div className="min-h-screen bg-transparent">
      <AgentRespondWidget address={agent.address} agentName={agent.name} />
      <div className="max-w-3xl mx-auto px-6 lg:px-10 pb-6 text-[10px] font-mono text-white/30">
        powered by{" "}
        <a
          href={`https://www.signaagent.xyz/agent/${address}`}
          target="_blank"
          rel="noreferrer"
          className="hover:text-white/55 underline underline-offset-4"
        >
          signaagent.xyz
        </a>{" "}
        — wallet-signed AI agent, free
      </div>
    </div>
  );
}
