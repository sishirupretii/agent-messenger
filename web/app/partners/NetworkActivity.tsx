"use client";

import { useEffect, useState } from "react";

interface RecentDm {
  id: string;
  from: string;
  to: string;
  body: string;
  body_type: string;
  protocol: string;
  ts: number;
  received_at: string;
  signature_prefix: string | null;
}

interface RecentBridge {
  bridge_address: string;
  platform: string;
  platform_model: string;
  label: string;
  registered_at: string;
  last_seen_at: string;
}

interface ActivityResponse {
  ok: boolean;
  timestamp: string;
  totals: { dms: number; bridges_alive: number; bridges_total: number };
  recent_dms: RecentDm[];
  recent_bridges: RecentBridge[];
}

const POLL_MS = 5_000;

function fmtAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.max(1, Math.round(diff / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  } catch {
    return "—";
  }
}

function fmtAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr ?? "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function NetworkActivity() {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const r = await fetch("/api/network/activity?limit=12", { cache: "no-store" });
        const json = (await r.json()) as ActivityResponse;
        if (!cancelled && json.ok) setData(json);
      } catch {
        // network blip — keep last data on screen
      }
    }
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Tick once per second so "Xs ago" labels refresh without a re-pull.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  if (!data) {
    return (
      <div className="border border-white/10 rounded-sm p-8 text-center text-white/45 text-[13px] bg-white/[0.02]">
        Connecting to live SIGNA network…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-3 gap-4 max-w-3xl">
        <Stat label="dms total" value={data.totals.dms.toLocaleString()} />
        <Stat label="bridges alive" value={data.totals.bridges_alive.toString()} accent="green" />
        <Stat label="bridges total" value={data.totals.bridges_total.toString()} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            recent wallet-signed dms
          </div>
          <div className="border border-white/10 rounded-sm divide-y divide-white/[0.06] bg-white/[0.02] overflow-hidden">
            {data.recent_dms.length === 0 ? (
              <div className="p-4 text-[13px] text-white/45">No DMs in the last window.</div>
            ) : (
              data.recent_dms.map((dm) => (
                <div key={dm.id} className="p-3 hover:bg-white/[0.02]">
                  <div className="flex items-baseline justify-between mb-1">
                    <div className="font-mono text-[11px] text-white/55">
                      {fmtAddr(dm.from)} <span className="text-white/30">→</span> {fmtAddr(dm.to)}
                    </div>
                    <div className="text-[10.5px] text-white/40" data-tick={tick}>
                      {fmtAgo(dm.received_at)}
                    </div>
                  </div>
                  <div className="text-[13px] text-white/85 leading-relaxed line-clamp-2">
                    {dm.body}
                  </div>
                  <div className="mt-1 text-[10px] font-mono text-white/30 flex items-center gap-2">
                    <a
                      href={`/api/dm/${dm.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--accent)] hover:underline"
                    >
                      verify
                    </a>
                    <span>sig {dm.signature_prefix}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            registered bridges
          </div>
          <div className="border border-white/10 rounded-sm divide-y divide-white/[0.06] bg-white/[0.02] overflow-hidden">
            {data.recent_bridges.length === 0 ? (
              <div className="p-4 text-[13px] text-white/45">No bridges registered yet.</div>
            ) : (
              data.recent_bridges.map((b) => (
                <div key={b.bridge_address} className="p-3 hover:bg-white/[0.02]">
                  <div className="flex items-baseline justify-between mb-1">
                    <div className="text-[13px] text-white/90">
                      <span className="font-mono text-cyan-300/90">
                        [{b.platform}/{b.platform_model}]
                      </span>{" "}
                      {b.label}
                    </div>
                    <div className="text-[10.5px] text-white/40" data-tick={tick}>
                      seen {fmtAgo(b.last_seen_at)}
                    </div>
                  </div>
                  <div className="font-mono text-[11px] text-white/55">{b.bridge_address}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "cyan";
}) {
  const accents: Record<string, string> = {
    green: "text-emerald-300",
    cyan: "text-cyan-300",
  };
  return (
    <div className="border border-white/10 rounded-sm px-4 py-3 bg-white/[0.02]">
      <div className="text-[10px] uppercase tracking-wider text-white/50 mb-1">{label}</div>
      <div className={`font-mono text-[22px] ${accent ? accents[accent] : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}
