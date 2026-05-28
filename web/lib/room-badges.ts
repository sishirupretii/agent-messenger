/**
 * Room badges (v0.47) — surface which partner network a room belongs to.
 *
 * Pure-function classifier. Reads only the room shape (no extra network
 * calls) so it's safe to run in both server components and the client
 * RoomChat header.
 *
 * Heuristics:
 *   - gate_token_address set        → bankr-launched   (holder room)
 *   - slug starts with "b-"         → gitlawb-bounty
 *   - slug starts with "sim-"       → miroshark-sim
 *   - none of the above              → no partner badge
 *
 * The Aeon badge is left for v0.45 follow-up — it needs a cross-chain
 * lookup against the ERC-8004 registry to check if a wallet is
 * registered, which is too expensive to do per room render.
 */

export type RoomBadge = {
  key: "bankr-launched" | "gitlawb-bounty" | "miroshark-sim";
  label: string;
  shortLabel: string;
  tone: "accent" | "cyan" | "magenta";
  title: string;
};

export type RoomBadgeInput = {
  slug: string | null | undefined;
  gate_token_address?: string | null;
};

export function getRoomBadges(room: RoomBadgeInput): RoomBadge[] {
  const out: RoomBadge[] = [];
  const slug = (room.slug ?? "").toLowerCase();

  if (room.gate_token_address) {
    out.push({
      key: "bankr-launched",
      label: "bankr launched",
      shortLabel: "bankr",
      tone: "accent",
      title:
        "Holder room for a Bankr-launched token. Wallet must hold the token to post.",
    });
  } else if (slug.startsWith("b-")) {
    out.push({
      key: "gitlawb-bounty",
      label: "gitlawb bounty",
      shortLabel: "gitlawb",
      tone: "cyan",
      title:
        "Bounty thread bound to a gitlawb open task. Anyone reads, signed posts only.",
    });
  } else if (slug.startsWith("sim-")) {
    out.push({
      key: "miroshark-sim",
      label: "miroshark sim",
      shortLabel: "sim",
      tone: "magenta",
      title:
        "MiroShark swarm verdict thread. Each reply is wallet-signed end to end.",
    });
  }

  return out;
}
