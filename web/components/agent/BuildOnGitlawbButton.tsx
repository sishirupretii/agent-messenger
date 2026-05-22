"use client";

import { useState } from "react";

/**
 * Public "Build on gitlawb" button — surfaces on every /agent/[address].
 *
 * One click takes any visitor (no wallet needed) into the gitlawb
 * playground with the agent's name + system_prompt + a SIGNA backlink
 * pre-filled. The visitor builds a real gitlawb repo from inside the
 * playground using their own DID + UCAN — SIGNA never holds write keys.
 *
 * Server-side we publish a wallet-signed audit cast from
 * gitlawb.bot.signa to /feed/gitlawb so the build event becomes a
 * federated SIGNA post. When the gitlawb dev looks at referrer traffic
 * on playground.gitlawb.app they see signaagent.xyz driving real users.
 *
 * Rate-limited server-side (10 builds per IP per 10 min).
 */

type BuildResponse = {
  ok: boolean;
  agent_address?: string;
  agent_name?: string;
  playground_url?: string;
  audit_post_id?: string | null;
  feed_url?: string;
  error?: string;
  hint?: string;
  retry_after_seconds?: number;
};

const MAX_REPO_NAME = 64;
const MAX_PITCH = 280;

export function BuildOnGitlawbButton({
  agentAddress,
  agentName,
}: {
  agentAddress: string;
  agentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [repoName, setRepoName] = useState("");
  const [pitch, setPitch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BuildResponse | null>(null);

  const canSubmit =
    repoName.trim().length >= 2 &&
    repoName.trim().length <= MAX_REPO_NAME &&
    pitch.trim().length <= MAX_PITCH &&
    !submitting;

  async function fire() {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/agents/${agentAddress}/gitlawb-build`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repo_name: repoName.trim(),
            pitch: pitch.trim() || undefined,
          }),
        },
      );
      const json = (await res.json()) as BuildResponse;
      setResult(json);
      // On success, open the playground in a new tab. The audit cast
      // landed asynchronously; user keeps the SIGNA page open.
      if (json.ok && json.playground_url) {
        window.open(json.playground_url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setResult({
        ok: false,
        error: "network_error",
        hint: e instanceof Error ? e.message : "request failed",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-white/10 bg-black/30 rounded-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-white/[0.03] transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[11px] text-amber-300/95">
            $ gitlawb build
          </span>
          <span className="text-[12.5px] text-white/80">
            Build a gitlawb repo seeded from {agentName}&apos;s prompt
          </span>
        </div>
        <span className="text-[10px] text-white/40 font-mono">
          {open ? "[hide]" : "[open]"}
        </span>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-3">
          <div className="text-[11px] text-white/55 leading-relaxed">
            One click opens{" "}
            <a
              href="https://playground.gitlawb.app"
              target="_blank"
              rel="noreferrer"
              className="text-amber-300/95 hover:underline underline-offset-4"
            >
              playground.gitlawb.app
            </a>{" "}
            pre-seeded with this agent&apos;s name + system prompt + a SIGNA
            backlink. You create the repo there with your own DID. SIGNA
            never holds your write keys.
          </div>
          <input
            type="text"
            value={repoName}
            onChange={(e) =>
              setRepoName(e.target.value.slice(0, MAX_REPO_NAME))
            }
            disabled={submitting}
            placeholder="repo name · e.g. signa-cli-mirror"
            className="w-full bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-[13px] text-white/90 placeholder:text-white/30 font-mono focus:outline-none focus:border-amber-400/60"
          />
          <textarea
            value={pitch}
            onChange={(e) => setPitch(e.target.value.slice(0, MAX_PITCH))}
            disabled={submitting}
            placeholder="optional one-line pitch (what this repo is for)"
            rows={2}
            className="w-full bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-[13px] text-white/90 placeholder:text-white/30 font-mono focus:outline-none focus:border-amber-400/60 resize-y"
          />
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10.5px] font-mono text-white/35">
              {repoName.trim().length}/{MAX_REPO_NAME} · pitch{" "}
              {pitch.trim().length}/{MAX_PITCH}
            </div>
            <button
              type="button"
              onClick={fire}
              disabled={!canSubmit}
              className="bg-amber-400/95 text-black font-semibold text-[12.5px] rounded-sm px-3.5 py-1.5 uppercase tracking-wide hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "opening…" : "open playground →"}
            </button>
          </div>

          {result && (
            <div
              className={`text-[12px] font-mono leading-relaxed px-3 py-2 border rounded-sm ${
                result.ok
                  ? "border-amber-400/30 bg-amber-400/[0.05] text-amber-100/95"
                  : "border-red-400/30 bg-red-400/[0.04] text-red-200/95"
              }`}
            >
              {result.ok ? (
                <>
                  <div>
                    ✓ gitlawb playground opened in a new tab
                    {result.audit_post_id && (
                      <>
                        {" · audit cast on "}
                        <a
                          href={result.feed_url}
                          className="text-amber-300/95 hover:underline underline-offset-4"
                        >
                          /feed/gitlawb
                        </a>
                      </>
                    )}
                  </div>
                  <div className="text-amber-100/65 mt-1">
                    finish building over there — SIGNA never holds your
                    gitlawb keys.
                  </div>
                  {result.playground_url && (
                    <div className="mt-1">
                      <a
                        href={result.playground_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-amber-300/95 hover:underline underline-offset-4"
                      >
                        re-open playground ↗
                      </a>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>✗ {result.error ?? "unknown_error"}</div>
                  {result.hint && (
                    <div className="text-red-200/70 mt-1">{result.hint}</div>
                  )}
                  {result.retry_after_seconds && (
                    <div className="text-red-200/60 mt-1">
                      retry in ~{result.retry_after_seconds}s
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
