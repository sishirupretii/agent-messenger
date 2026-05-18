/**
 * gitlawb integration — read-only MCP tool surface for the SIGNA agent.
 *
 * gitlawb's network is fully signature-authenticated (Ed25519 keys, UCAN
 * capability delegation) and their MCP server is a local stdio process
 * (`gl mcp serve`) — there's no public HTTP read endpoint we can hit
 * anonymously.
 *
 * Until the agent runtime is configured with a gitlawb DID + key pair,
 * these tool implementations return a structured "setup required" payload
 * (NOT a fake response). When env is filled and the gitlawb CLI is
 * installed alongside the agent, the implementations can be swapped to
 * spawn `gl` subprocesses and parse stdio.
 */

export type GitlawbConfig = {
  did: string | null;
  keyPath: string | null;
  nodeUrl: string;
};

export function getGitlawbConfig(): GitlawbConfig {
  return {
    did: process.env.GITLAWB_DID || null,
    keyPath: process.env.GITLAWB_KEY || null,
    nodeUrl: process.env.GITLAWB_NODE || "https://node.gitlawb.com",
  };
}

export function gitlawbConfigured(cfg = getGitlawbConfig()): boolean {
  return !!(cfg.did && cfg.keyPath);
}

/**
 * Common setup-required error payload. Keeps tool responses honest when
 * env is missing — Groq sees the error and can explain it to the user
 * instead of fabricating repo lists.
 */
export function setupRequiredError(tool: string): string {
  return JSON.stringify({
    error: "gitlawb_not_configured",
    tool,
    message:
      "gitlawb read tools need agent-side setup: set GITLAWB_DID + GITLAWB_KEY on the agent service. See https://gitlawb.com/agents for keypair + DID generation.",
    docs: "https://gitlawb.com/agents",
  });
}

export async function listRepos(ownerDid?: string): Promise<string> {
  const cfg = getGitlawbConfig();
  if (!gitlawbConfigured(cfg)) return setupRequiredError("gitlawb_list_repos");
  // Real implementation lands when GITLAWB_DID/KEY are wired + gl CLI is on PATH.
  return JSON.stringify({
    error: "gitlawb_not_wired",
    tool: "gitlawb_list_repos",
    message:
      "GITLAWB_DID + GITLAWB_KEY are set, but the gl CLI isn't installed on the agent runtime. Install with `npm i -g @gitlawb/cli` or via the nixpacks build step, then this tool will return real repo data.",
    args: { ownerDid: ownerDid ?? null },
    node: cfg.nodeUrl,
  });
}

export async function repoInfo(repoDid: string): Promise<string> {
  const cfg = getGitlawbConfig();
  if (!gitlawbConfigured(cfg)) return setupRequiredError("gitlawb_get_repo");
  return JSON.stringify({
    error: "gitlawb_not_wired",
    tool: "gitlawb_get_repo",
    message:
      "GITLAWB_DID + GITLAWB_KEY are set, but the gl CLI isn't installed on the agent runtime. See gitlawb.com/agents.",
    args: { repoDid },
    node: cfg.nodeUrl,
  });
}

export async function listPrs(repoDid: string): Promise<string> {
  const cfg = getGitlawbConfig();
  if (!gitlawbConfigured(cfg)) return setupRequiredError("gitlawb_list_prs");
  return JSON.stringify({
    error: "gitlawb_not_wired",
    tool: "gitlawb_list_prs",
    message:
      "GITLAWB_DID + GITLAWB_KEY are set, but the gl CLI isn't installed on the agent runtime. See gitlawb.com/agents.",
    args: { repoDid },
    node: cfg.nodeUrl,
  });
}
