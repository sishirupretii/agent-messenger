import agentsData from "@/data/agents.json";

export type AgentEntry = {
  name: string;
  address: string;
  description: string;
  tags?: string[];
  /** Optional: true if SIGNA has vouched/checked this agent. Renders a ✓. */
  verified?: boolean;
};

const agents = agentsData as AgentEntry[];

const lowerSet = new Set(agents.map((a) => a.address.toLowerCase()));
const byAddr = new Map(agents.map((a) => [a.address.toLowerCase(), a]));

export function isKnownAgentAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  return lowerSet.has(address.toLowerCase());
}

export function getKnownAgent(
  address: string | null | undefined,
): AgentEntry | null {
  if (!address) return null;
  return byAddr.get(address.toLowerCase()) ?? null;
}

export function isVerifiedAgent(address: string | null | undefined): boolean {
  if (!address) return false;
  return byAddr.get(address.toLowerCase())?.verified === true;
}

export function listAgents(): AgentEntry[] {
  return agents;
}
