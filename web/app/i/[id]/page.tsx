import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { PeerAvatar } from "@/components/ui/Avatar";
import { shortAddress } from "@/lib/format";
import { VerifySignatureButton } from "@/components/agent/VerifySignatureButton";

export const dynamic = "force-dynamic";

/**
 * Public permalink for a single agent reply.
 *
 * Renders the Q + A + signature + cited sources for one interaction
 * from agent_interactions. Anyone can land here from a shared link
 * (twitter, farcaster, anywhere) and:
 *
 *   - See exactly what was asked and what was answered.
 *   - Click "verify signature" and run viem.verifyMessage IN THEIR
 *     BROWSER — no trust required in SIGNA's servers for the proof.
 *   - See WHICH partner answered (sources block).
 *   - Tweet / re-share with a custom OG card.
 *   - Click through to the agent's profile to ask their own question.
 *
 * Layout is a unix-style transcript, not a chat-card. The signature
 * box is the centerpiece — that's the network-effect lever, the thing
 * Twitter / Discord / Farcaster can't fake.
 */

type Interaction = {
  id: string;
  agent_address: string;
  sender_address: string | null;
  message: string;
  response: string;
  intent: string;
  sources: Array<{ kind: string; ref: string }>;
  signed: boolean;
  signature: string | null;
  signed_message: string | null;
  rating: number | null;
  created_at: string;
};

type Agent = {
  address: string;
  name: string;
  description: string;
  tags: string[] | null;
  avatar_seed: string | null;
  gitlawb_did: string | null;
  erc8004_token_id: string | null;
  bankr_token_address: string | null;
  launched_by: string | null;
};

async function loadInteraction(id: string): Promise<{
  interaction: Interaction;
  agent: Agent | null;
} | null> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("host") || "www.signaagent.xyz";
  const url = `${proto}://${host}/api/interactions/${id}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      ok: boolean;
      interaction: Interaction;
      agent: Agent | null;
    };
    if (!j.ok) return null;
    return { interaction: j.interaction, agent: j.agent };
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const loaded = await loadInteraction(id);
  if (!loaded) return { title: "reply not found · signa" };
  const { interaction, agent } = loaded;
  const speaker = agent?.name ?? interaction.agent_address.slice(0, 10);
  const preview = interaction.response.slice(0, 160).replace(/\s+/g, " ");
  return {
    title: `${speaker} · signed reply · signa`,
    description: preview,
    openGraph: {
      title: `${speaker} · signed reply`,
      description: preview,
      url: `https://www.signaagent.xyz/i/${id}`,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `${speaker} · signed reply`,
      description: preview,
    },
  };
}

function shareTweetUrl(id: string, agent: Agent | null, response: string) {
  const speaker = agent?.name ?? "an agent on signaagent.xyz";
  const url = `https://www.signaagent.xyz/i/${id}`;
  const text =
    `${speaker} said this — and it's wallet-signed (verifiable in-browser):\n\n` +
    `"${response.slice(0, 140)}"\n\n` +
    url;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

export default async function InteractionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const loaded = await loadInteraction(id);
  if (!loaded) notFound();
  const { interaction: itx, agent } = loaded;

  const speakerName = agent?.name ?? `agent ${shortAddress(itx.agent_address)}`;
  const speakerAvatar = agent?.avatar_seed || itx.agent_address;
  const createdIso = itx.created_at.slice(0, 19).replace("T", " ");

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1 font-mono text-[13px] leading-[1.75] text-white/85">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-10 pb-14">
          {/* Header */}
          <div className="flex items-baseline justify-between text-white/40 text-[11px] mb-8">
            <span>SIGNA REPLY · {createdIso}Z</span>
            <Link
              href="/feed"
              className="hover:text-white"
            >
              ../feed
            </Link>
          </div>

          {/* Speaker */}
          <section className="mb-8">
            <h2 className="text-white tracking-[0.18em] text-[11px] mb-3">
              SPEAKER
            </h2>
            <div className="pl-4 border-l border-white/[0.06] flex items-start gap-3">
              <PeerAvatar address={speakerAvatar} size={40} />
              <div className="min-w-0 flex-1">
                <div className="text-white">
                  <Link
                    href={`/agent/${itx.agent_address}`}
                    className="hover:underline underline-offset-4"
                  >
                    {speakerName}
                  </Link>
                </div>
                <div className="text-white/40 break-all">
                  {itx.agent_address}
                </div>
                {agent?.gitlawb_did && (
                  <div className="text-white/40 mt-1">
                    <span className="text-[var(--accent)]/85">did</span>{" "}
                    {agent.gitlawb_did}
                  </div>
                )}
                {agent?.erc8004_token_id && (
                  <div className="text-white/40">
                    <span className="text-[var(--accent)]/85">erc-8004</span> #
                    {agent.erc8004_token_id}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Q */}
          <section className="mb-6">
            <h2 className="text-white tracking-[0.18em] text-[11px] mb-2">
              QUESTION
              {itx.sender_address && (
                <span className="text-white/30 normal-case ml-2 tracking-normal">
                  from{" "}
                  <Link
                    href={`/u/${itx.sender_address}`}
                    className="hover:underline underline-offset-4"
                  >
                    {shortAddress(itx.sender_address)}
                  </Link>
                </span>
              )}
            </h2>
            <pre className="whitespace-pre-wrap pl-4 border-l border-white/[0.06] text-white/85">
              {itx.message}
            </pre>
          </section>

          {/* A */}
          <section className="mb-8">
            <h2 className="text-white tracking-[0.18em] text-[11px] mb-2">
              REPLY
              <span className="text-white/30 normal-case ml-2 tracking-normal">
                intent: <span className="text-[var(--accent)]/85">{itx.intent}</span>
              </span>
            </h2>
            <pre className="whitespace-pre-wrap pl-4 border-l border-white/[0.06] text-white">
              {itx.response}
            </pre>
          </section>

          {/* Signature */}
          <section className="mb-8">
            <h2 className="text-white tracking-[0.18em] text-[11px] mb-2">
              SIGNATURE
            </h2>
            <div className="pl-4 border-l border-white/[0.06] space-y-1">
              {itx.signed && itx.signature && itx.signed_message ? (
                <>
                  <div className="text-white/40">
                    <span className="text-[var(--accent)]/85 mr-3">algo</span>
                    EIP-191 (personal_sign) over canonical preimage
                  </div>
                  <div className="text-white/40 break-all">
                    <span className="text-[var(--accent)]/85 mr-3">sig</span>
                    {itx.signature}
                  </div>
                  <div className="text-white/40 break-all">
                    <span className="text-[var(--accent)]/85 mr-3">addr</span>
                    {itx.agent_address}
                  </div>
                  <div className="pt-2">
                    <VerifySignatureButton
                      address={itx.agent_address}
                      message={itx.signed_message}
                      signature={itx.signature}
                    />
                  </div>
                </>
              ) : (
                <div className="text-white/45">
                  // unsigned — this agent runs without custodial signing.
                  Anyone can opt-in via{" "}
                  <Link
                    href={`/agent/${itx.agent_address}/runtime`}
                    className="underline underline-offset-4 hover:text-white"
                  >
                    /agent/{shortAddress(itx.agent_address)}/runtime
                  </Link>
                </div>
              )}
            </div>
          </section>

          {/* Sources */}
          {itx.sources && itx.sources.length > 0 && (
            <section className="mb-8">
              <h2 className="text-white tracking-[0.18em] text-[11px] mb-2">
                SOURCES
              </h2>
              <table className="pl-4 border-l border-white/[0.06] w-full border-collapse">
                <tbody>
                  {itx.sources.map((s, i) => (
                    <tr key={i} className="align-top">
                      <td className="text-[var(--accent)]/85 pr-4 py-0.5 whitespace-nowrap w-[110px]">
                        {s.kind}
                      </td>
                      <td className="text-white/70 py-0.5 break-all">
                        {s.ref}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Actions */}
          <section className="mb-8">
            <h2 className="text-white tracking-[0.18em] text-[11px] mb-2">
              ACTIONS
            </h2>
            <div className="pl-4 border-l border-white/[0.06] space-x-4">
              <a
                href={shareTweetUrl(itx.id, agent, itx.response)}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] hover:underline underline-offset-4"
              >
                [ share on x ]
              </a>
              <Link
                href={`/agent/${itx.agent_address}`}
                className="text-[var(--accent)] hover:underline underline-offset-4"
              >
                [ ask {speakerName} ]
              </Link>
              <a
                href={`/api/interactions/${itx.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-white/55 hover:text-white underline underline-offset-4"
              >
                view raw json
              </a>
            </div>
          </section>

          <div className="text-white/30 text-[11px]"># eof · {itx.id}</div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
