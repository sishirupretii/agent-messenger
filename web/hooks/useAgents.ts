"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentEntry } from "@/lib/feed-types";
import partnersJson from "@/data/partners.json";

/**
 * Agent list = static featured partners (from web/data/partners.json) on
 * top, then community-submitted agents from /api/agents (Supabase) below.
 * Partners are immutable from the user's POV — they're versioned in the
 * repo, not via Supabase, so a bad community submission can't impersonate
 * a partner.
 *
 * Module-level cache + listener set so multiple consumers share one
 * network request.
 */

const PARTNERS: AgentEntry[] = (partnersJson as AgentEntry[]).map((p) => ({
  ...p,
  // featured partners always render as verified
  verified: p.verified ?? true,
  featured: p.featured ?? true,
  verified_partner: p.verified_partner ?? true,
}));

let cache: AgentEntry[] | null = null;
let inflight: Promise<AgentEntry[]> | null = null;
const listeners = new Set<(a: AgentEntry[]) => void>();

async function fetchAgents(force = false): Promise<AgentEntry[]> {
  if (!force && cache) return cache;
  if (!force && inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/agents", { cache: "no-store" });
      const json = (await res.json()) as { agents?: AgentEntry[] };
      const community = json.agents ?? [];
      // partners first, community below; partners never duplicate (their addresses are empty)
      const merged = [...PARTNERS, ...community];
      cache = merged;
      listeners.forEach((fn) => fn(merged));
      return merged;
    } catch {
      // If the API errors, still serve partners so the directory isn't empty
      const merged = [...PARTNERS];
      cache = merged;
      listeners.forEach((fn) => fn(merged));
      return merged;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function refreshAgents(): Promise<AgentEntry[]> {
  return fetchAgents(true);
}

export type UseAgentsResult = {
  agents: AgentEntry[];
  partners: AgentEntry[];
  community: AgentEntry[];
  loading: boolean;
  isKnownAgent: (address: string | null | undefined) => boolean;
  getKnownAgent: (address: string | null | undefined) => AgentEntry | null;
  isVerifiedAgent: (address: string | null | undefined) => boolean;
  refresh: () => Promise<AgentEntry[]>;
};

export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<AgentEntry[]>(cache ?? PARTNERS);
  const [loading, setLoading] = useState<boolean>(cache === null);

  useEffect(() => {
    const onUpdate = (next: AgentEntry[]) => {
      setAgents(next);
      setLoading(false);
    };
    listeners.add(onUpdate);
    if (cache === null) {
      void fetchAgents().then((got) => {
        setAgents(got);
        setLoading(false);
      });
    } else {
      setAgents(cache);
      setLoading(false);
    }
    return () => {
      listeners.delete(onUpdate);
    };
  }, []);

  const byAddr = useMemo(() => {
    const m = new Map<string, AgentEntry>();
    for (const a of agents) {
      if (a.address) m.set(a.address.toLowerCase(), a);
    }
    return m;
  }, [agents]);

  const { partners, community } = useMemo(() => {
    const p: AgentEntry[] = [];
    const c: AgentEntry[] = [];
    for (const a of agents) {
      if (a.featured || a.verified_partner) p.push(a);
      else c.push(a);
    }
    return { partners: p, community: c };
  }, [agents]);

  return {
    agents,
    partners,
    community,
    loading,
    isKnownAgent: (address) => !!address && byAddr.has(address.toLowerCase()),
    getKnownAgent: (address) =>
      address ? byAddr.get(address.toLowerCase()) ?? null : null,
    isVerifiedAgent: (address) =>
      !!address && byAddr.get(address.toLowerCase())?.verified === true,
    refresh: () => fetchAgents(true),
  };
}
