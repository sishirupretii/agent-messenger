import type { Dm } from "@xmtp/browser-sdk";

/**
 * Resolve the peer's Ethereum address from a 1:1 DM by inspecting members.
 * Returns null if not found.
 */
export async function getPeerAddressFromDm(
  dm: Dm,
  ownInboxId: string,
): Promise<string | null> {
  try {
    const members = await dm.members();
    const peer = members.find((m) => m.inboxId !== ownInboxId);
    if (!peer) return null;
    // Each member has accountIdentifiers: { identifier, identifierKind }[]
    const identifiers = (peer as unknown as { accountIdentifiers?: Array<{ identifier: string }> })
      .accountIdentifiers;
    const first = identifiers?.[0];
    if (first?.identifier) return first.identifier.toLowerCase();
    return null;
  } catch {
    return null;
  }
}
