import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { PeerAvatar } from "@/components/ui/Avatar";
import { shortAddress } from "@/lib/format";
import { RuntimeOptIn } from "./RuntimeOptIn";

export const dynamic = "force-dynamic";

type Agent = {
  address: string;
  name: string;
  description: string;
  avatar_seed: string | null;
  runtime_enabled: boolean;
  runtime_enabled_at: string | null;
  encrypted_key: string | null;
  launched_at: string | null;
};

async function getAgent(address: string): Promise<Agent | null> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("host") || "www.signaagent.xyz";
  try {
    const res = await fetch(`${proto}://${host}/api/agents/${address}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.agent ?? null;
  } catch {
    return null;
  }
}

export default async function AgentRuntimePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) notFound();

  const agent = await getAgent(address);
  if (!agent) notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-2xl mx-auto px-6 lg:px-10 pt-12 pb-10">
            <Link
              href={`/agent/${address}`}
              className="text-xs text-white/45 hover:text-white inline-flex items-center gap-1 mb-8"
            >
              <ArrowLeft className="size-3" />
              ../agent/{shortAddress(address)}
            </Link>
            <div className="font-mono text-[11px] text-[var(--accent)] mb-4">
              $ signa runtime enable --agent {shortAddress(address)}
            </div>
            <div className="flex items-start gap-4 mb-7">
              <PeerAvatar address={agent.avatar_seed || agent.address} size={56} />
              <div className="min-w-0">
                <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-[-0.035em] leading-tight">
                  Run {agent.name} on SIGNA.
                </h1>
                <p className="text-white/55 text-[12px] font-mono mt-1.5 break-all">
                  {address}
                </p>
              </div>
            </div>
            <p className="text-white/65 text-[15px] leading-relaxed max-w-xl">
              Hand SIGNA the agent&apos;s private key once. We encrypt it with
              AES-256-GCM using a server-side master key and run an XMTP
              listener + Groq inference loop on its behalf. Anyone DMing this
              agent gets a real reply using the system prompt from launch.
            </p>
          </div>
        </section>

        <RuntimeOptIn
          agentAddress={address}
          agentName={agent.name}
          alreadyEnabled={agent.runtime_enabled}
          keyOnFile={!!agent.encrypted_key}
          enabledAt={agent.runtime_enabled_at}
        />

        <section className="border-b border-white/[0.06]">
          <div className="max-w-2xl mx-auto px-6 lg:px-10 py-10 text-[13px] text-white/65 leading-relaxed space-y-3">
            <div className="font-mono text-[11px] text-[var(--accent)]">
              # how custody works
            </div>
            <p>
              The plaintext private key is sent to <code className="font-mono text-[12px] bg-white/[0.05] rounded px-1 py-0.5">/api/agents/{shortAddress(address)}/enable-runtime</code> over HTTPS, encrypted
              with AES-256-GCM on the server, and stored in our database as a
              ciphertext blob. The plaintext is never logged, never returned,
              never written to disk.
            </p>
            <p>
              The encryption master key (<code className="font-mono text-[12px] bg-white/[0.05] rounded px-1 py-0.5">AGENT_RUNTIME_MASTER_KEY</code>)
              lives only in Vercel + Railway env vars. A stolen Supabase dump
              without the master key is useless — the blobs decrypt to nothing.
            </p>
            <p>
              You can disable + purge at any time via{" "}
              <code className="font-mono text-[12px] bg-white/[0.05] rounded px-1 py-0.5">/api/agents/{shortAddress(address)}/disable-runtime?purge=true</code> with a signed
              attestation.
            </p>
            <p className="text-white/40 text-[11px] mt-4">
              The vault uses AES-256-GCM. Keys are encrypted before they
              touch the database and decrypted only inside the Node
              process that signs replies on the agent&apos;s behalf.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
