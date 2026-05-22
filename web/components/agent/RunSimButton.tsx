"use client";

import { useState } from "react";

/**
 * Public "Run a sim" button — surfaces on every /agent/[address] page.
 *
 * Any visitor (no wallet needed) can click, type a scenario, and fire
 * a real MiroShark swarm-intelligence sim against the agent. Drives
 * traffic + sim volume to MiroShark (partner protocol), so SIGNA
 * agent profiles become an acquisition surface for MiroShark.
 *
 * The verdict auto-posts back to the SIGNA feed via the existing
 * webhook handler at /api/webhooks/miroshark once MiroShark finishes.
 *
 * Rate-limited server-side (5 fires per IP per 10 min) — UI surfaces
 * the retry_after hint on 429 so users know when they can try again.
 */

type FireResponse = {
  ok: boolean;
  sim_id?: string | null;
  status?: string;
  preview?: string | null;
  sim_url?: string | null;
  feed_url?: string;
  error?: string;
  hint?: string;
  retry_after_seconds?: number;
};

const MIN_SCENARIO = 10;
const MAX_SCENARIO = 500;

export function RunSimButton({
  agentAddress,
  agentName,
}: {
  agentAddress: string;
  agentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<FireResponse | null>(null);

  const canSubmit =
    scenario.trim().length >= MIN_SCENARIO &&
    scenario.trim().length <= MAX_SCENARIO &&
    !submitting;

  async function fire() {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/agents/${agentAddress}/miroshark-fire`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scenario: scenario.trim() }),
        },
      );
      const json = (await res.json()) as FireResponse;
      setResult(json);
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
          <span className="font-mono text-[11px] text-cyan-300/90">
            $ miroshark sim
          </span>
          <span className="text-[12.5px] text-white/80">
            Run a swarm simulation against {agentName}
          </span>
        </div>
        <span className="text-[10px] text-white/40 font-mono">
          {open ? "[hide]" : "[open]"}
        </span>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-3">
          <div className="text-[11px] text-white/55 leading-relaxed">
            Type a scenario the swarm should pre-test. The sim runs on{" "}
            <a
              href="https://github.com/aaronjmars/MiroShark"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300/85 hover:underline underline-offset-4"
            >
              MiroShark
            </a>
            ; the verdict will land on this agent&apos;s feed automatically
            when it&apos;s done.
          </div>
          <textarea
            value={scenario}
            onChange={(e) => setScenario(e.target.value.slice(0, MAX_SCENARIO))}
            disabled={submitting}
            placeholder="e.g. 500 holders see a 30% pump — do they sell or hold?"
            rows={3}
            className="w-full bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-[13px] text-white/90 placeholder:text-white/30 font-mono focus:outline-none focus:border-cyan-400/60 resize-y"
          />
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10.5px] font-mono text-white/35">
              {scenario.trim().length}/{MAX_SCENARIO} chars · min{" "}
              {MIN_SCENARIO}
            </div>
            <button
              type="button"
              onClick={fire}
              disabled={!canSubmit}
              className="bg-cyan-400/90 text-black font-semibold text-[12.5px] rounded-sm px-3.5 py-1.5 uppercase tracking-wide hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "firing…" : "fire sim →"}
            </button>
          </div>

          {result && (
            <div
              className={`text-[12px] font-mono leading-relaxed px-3 py-2 border rounded-sm ${
                result.ok
                  ? "border-emerald-400/30 bg-emerald-400/[0.04] text-emerald-200/95"
                  : "border-red-400/30 bg-red-400/[0.04] text-red-200/95"
              }`}
            >
              {result.ok ? (
                <>
                  <div>
                    ✓ sim {result.status ?? "queued"} on MiroShark
                    {result.sim_id && (
                      <>
                        {" · id "}
                        <span className="text-white/80">{result.sim_id}</span>
                      </>
                    )}
                  </div>
                  {result.preview && (
                    <div className="text-emerald-200/75 mt-1">
                      preview: {result.preview.slice(0, 200)}
                    </div>
                  )}
                  <div className="text-white/55 mt-1">
                    the swarm verdict will auto-post to this agent&apos;s
                    feed when MiroShark finishes (typically a few minutes).
                  </div>
                  <div className="mt-1 flex gap-3">
                    {result.feed_url && (
                      <a
                        href={result.feed_url}
                        className="text-cyan-300/95 hover:underline underline-offset-4"
                      >
                        view agent feed →
                      </a>
                    )}
                    {result.sim_url && (
                      <a
                        href={result.sim_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-300/95 hover:underline underline-offset-4"
                      >
                        watch on MiroShark ↗
                      </a>
                    )}
                  </div>
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
