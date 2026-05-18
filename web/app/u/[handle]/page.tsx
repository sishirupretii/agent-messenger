import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import {
  ArrowLeft,
  ArrowUpRight,
  MessageCircle,
  Twitter,
} from "lucide-react";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { PeerAvatar } from "@/components/ui/Avatar";
import { HolderBadges } from "@/components/ui/HolderBadges";
import { shortAddress } from "@/lib/format";
import { getHolderStatus } from "@/lib/holder-status";
import { LinkGitlawb } from "./LinkGitlawb";

export const dynamic = "force-dynamic";

type Resolved = {
  ok: true;
  handle: string;
  address: string;
  basename: string | null;
  ens_name: string | null;
  gitlawb_did: string | null;
  on_signa: boolean;
  source: string;
};

type Post = {
  id: string;
  author_address: string;
  content: string;
  parent_id: string | null;
  created_at: string;
};

type Agent = {
  address: string;
  name: string;
  description: string;
  tags: string[] | null;
  avatar_seed: string | null;
  launched_at: string | null;
  launched_by: string | null;
};

async function api<T>(
  pathAndQuery: string,
): Promise<T | null> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("host") || "www.signaagent.xyz";
  try {
    const res = await fetch(`${proto}://${host}${pathAndQuery}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function shareTweetUrl(r: Resolved): string {
  const url = `https://www.signaagent.xyz/u/${encodeURIComponent(r.handle)}`;
  const who = r.basename || r.ens_name || shortAddress(r.address);
  const text =
    `meet ${who} on @signa_agent — wallet-native messaging on @base.\n\n` +
    `DM them with one click: signaagent.xyz/dm/${encodeURIComponent(r.handle)}\n\n` +
    url;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle: raw } = await params;
  const handle = decodeURIComponent(raw);
  const display = handle.length > 30 ? `${handle.slice(0, 30)}…` : handle;
  return {
    title: `${display} on SIGNA`,
    description: `Wallet-native profile for ${display}. DM them encrypted over XMTP on Base.`,
    openGraph: {
      title: `${display} on SIGNA`,
      description: `Wallet-native profile. Encrypted DMs. On Base.`,
      type: "profile",
    },
    twitter: {
      card: "summary",
      title: `${display} on SIGNA`,
    },
  };
}

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle: raw } = await params;
  const handle = decodeURIComponent(raw);

  const resolved = await api<Resolved>(
    `/api/users/resolve?handle=${encodeURIComponent(handle)}`,
  );
  if (!resolved || !resolved.ok) notFound();

  const display =
    resolved.basename ??
    resolved.ens_name ??
    shortAddress(resolved.address, 8, 6);

  // Fan out: posts, agents-launched, holdings in parallel.
  const [postsResp, agentsResp, holderStatus] = await Promise.all([
    api<{ posts: Post[] }>(
      `/api/posts?author=${resolved.address}&limit=20`,
    ),
    api<{ agents: Agent[] }>("/api/agents"),
    getHolderStatus(resolved.address).catch(() => ({
      holdings: [] as never,
    } as { holdings: { symbol: string; project: string | null; amount: string }[] })),
  ]);

  const posts: Post[] = postsResp?.posts ?? [];
  const launchedAgents: Agent[] = (agentsResp?.agents ?? []).filter(
    (a) =>
      a.launched_by?.toLowerCase() === resolved.address.toLowerCase() &&
      a.launched_at,
  );
  const holdings = holderStatus.holdings ?? [];

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-12 pb-10">
            <Link
              href="/directory"
              className="text-xs text-white/45 hover:text-white inline-flex items-center gap-1 mb-8"
            >
              <ArrowLeft className="size-3" />
              ../directory
            </Link>
            <div className="flex items-start gap-5">
              <PeerAvatar address={resolved.address} size={80} />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11px] text-[var(--accent)] mb-1.5">
                  $ signa profile {display}
                </div>
                <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-[-0.035em] leading-tight break-all">
                  {display}
                </h1>
                <div className="text-[11px] font-mono text-white/40 mt-1.5 break-all">
                  {resolved.address}
                </div>
                {holdings.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5">
                      holds
                    </div>
                    <HolderBadges holdings={holdings} showAmount />
                  </div>
                )}
                {resolved.gitlawb_did && (
                  <div className="mt-4">
                    <div className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5 flex items-center gap-1.5">
                      <span className="size-1 rounded-full bg-emerald-400 inline-block" />
                      gitlawb
                    </div>
                    <a
                      href={`https://gitlawb.com/agents/${encodeURIComponent(resolved.gitlawb_did)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 border border-emerald-300/30 bg-emerald-300/[0.04] text-emerald-200 hover:bg-emerald-300/[0.08] transition px-2 py-1 rounded-sm font-mono text-[11px]"
                    >
                      {resolved.gitlawb_did.length > 36
                        ? `${resolved.gitlawb_did.slice(0, 30)}…${resolved.gitlawb_did.slice(-4)}`
                        : resolved.gitlawb_did}
                      <ArrowUpRight className="size-3" />
                    </a>
                  </div>
                )}
                <LinkGitlawb
                  profileAddress={resolved.address}
                  currentDid={resolved.gitlawb_did}
                />
              </div>
              <div className="flex flex-col gap-2 flex-shrink-0">
                <Link
                  href={`/dm/${encodeURIComponent(handle)}`}
                  className="bg-[var(--accent)] text-black text-sm font-semibold rounded-md px-3.5 py-2 inline-flex items-center gap-1.5 hover:brightness-110 transition uppercase tracking-wide"
                >
                  <MessageCircle className="size-3.5" />
                  DM
                </Link>
                <a
                  href={shareTweetUrl(resolved)}
                  target="_blank"
                  rel="noreferrer"
                  className="border border-white/15 text-white text-sm rounded-md px-3.5 py-2 inline-flex items-center gap-1.5 hover:bg-white/[0.04] transition"
                >
                  <Twitter className="size-3.5" />
                  Share
                </a>
              </div>
            </div>
          </div>
        </section>

        {launchedAgents.length > 0 && (
          <section className="border-b border-white/[0.06]">
            <div className="max-w-3xl mx-auto px-6 lg:px-10 py-10">
              <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
                $ signa list-agents --by {display}
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {launchedAgents.map((a) => (
                  <Link
                    key={a.address}
                    href={`/agent/${a.address}`}
                    className="border border-white/10 px-3 py-3 hover:bg-white/[0.03] transition flex items-start gap-3 group"
                  >
                    <PeerAvatar
                      address={a.avatar_seed || a.address}
                      size={32}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 justify-between">
                        <span className="font-display text-[15px] text-white font-semibold truncate">
                          {a.name}
                        </span>
                        <ArrowUpRight className="size-3 text-white/30 group-hover:text-white flex-shrink-0" />
                      </div>
                      <p className="text-[11px] text-white/55 leading-snug line-clamp-2 mt-0.5">
                        {a.description}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 py-10">
            <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
              $ signa feed --author {display}
            </div>
            {posts.length === 0 ? (
              <div className="border border-dashed border-white/15 px-4 py-6 font-mono text-[12px] text-white/55">
                {`>`} no posts yet from {display}.
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
                {posts.map((p) => (
                  <article key={p.id} className="py-4">
                    <Link
                      href={`/feed/${resolved.address}/post/${p.id}`}
                      className="block hover:opacity-80 transition"
                    >
                      <div className="text-[11px] font-mono text-white/35 mb-1.5">
                        {new Date(p.created_at).toISOString().slice(0, 16).replace("T", " ")}
                      </div>
                      <div className="text-[14px] text-white/85 whitespace-pre-wrap leading-relaxed">
                        {p.content}
                      </div>
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
