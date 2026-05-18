/**
 * Server-side helper to fire a SIGNA cron route in the background
 * when a relevant page is visited. Keeps feeds fresh without relying
 * on GitHub Actions / Vercel cron schedules (which are flaky on free
 * tiers).
 *
 * Throttled via cron_state so we don't hammer the cron route on
 * every page load — only fires if last run > THROTTLE_MS ago.
 *
 * Fire-and-forget: caller awaits the throttle-check but the actual
 * cron run happens in the background. Page render is never blocked.
 */

import { readState, writeState } from "./cron-state";

const THROTTLE_MS = 5 * 60 * 1000; // 5 min

type LastRun = { ts: number };

export async function triggerCronIfStale(name: "bankr" | "gitlawb" | "agent-tokens") {
  const key = `cron.${name}.last_visit_trigger`;
  const last = await readState<LastRun>(key, { ts: 0 });
  const now = Date.now();
  if (now - last.ts < THROTTLE_MS) return;

  // Update first so concurrent visitors don't race.
  await writeState<LastRun>(key, { ts: now });

  const secret = process.env.CRON_SECRET;
  if (!secret) return;

  // Construct the URL from VERCEL_URL (deployment-scoped) or fall back
  // to the canonical domain.
  const host =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://www.signaagent.xyz");

  // Fire-and-forget. Don't await — page render must not block on a
  // 5-second BaseScan call.
  void fetch(`${host}/api/cron/${name}`, {
    headers: { authorization: `Bearer ${secret}` },
    // Important: prevent Next from caching the trigger response.
    cache: "no-store",
  }).catch(() => {
    // Swallow — we'll try again next visit.
  });
}
