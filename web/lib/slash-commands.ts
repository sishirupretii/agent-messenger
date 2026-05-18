export type SlashRoute = {
  key: "bankr" | "aeon" | "gitlawb" | "miroshark";
  label: string;
  hint: string;
  build: (rest: string) => string; // url to open
};

/**
 * Slash-command router. Detects `/bankr ...`, `/aeon ...`, `/gitlawb ...`,
 * `/miroshark ...` at the start of the composer and offers a deep-link
 * card. SIGNA stays the messenger — these route traffic to partners.
 */
export const SLASH_ROUTES: SlashRoute[] = [
  {
    key: "bankr",
    label: "Bankr Terminal",
    hint: "Trade on Bankr",
    build: (rest) => {
      const q = rest.trim();
      // No public deep-link spec; pass through as a search query.
      const url = "https://bankr.bot";
      return q ? `${url}/?q=${encodeURIComponent(q)}` : url;
    },
  },
  {
    key: "aeon",
    label: "AEON Pay",
    hint: "Pay with AEON",
    build: () => "https://aeon.xyz",
  },
  {
    key: "gitlawb",
    label: "gitlawb",
    hint: "Decentralized git for agents",
    build: () => "https://gitlawb.com",
  },
  {
    key: "miroshark",
    label: "MiroShark",
    hint: "AI agent simulation",
    build: () => "https://web3.bitget.com/swap/base/0xd7bc6a05a56655FB2052F742B012d1DFD66e1BA3",
  },
];

const KEYS = SLASH_ROUTES.map((r) => r.key).join("|");
const SLASH_RE = new RegExp(`^/(${KEYS})\\b\\s*(.*)$`, "i");

export function parseSlash(input: string): { route: SlashRoute; rest: string } | null {
  const m = input.match(SLASH_RE);
  if (!m) return null;
  const key = m[1].toLowerCase() as SlashRoute["key"];
  const route = SLASH_ROUTES.find((r) => r.key === key);
  if (!route) return null;
  return { route, rest: m[2] ?? "" };
}
