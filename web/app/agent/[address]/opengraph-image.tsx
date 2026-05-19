import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "signa agent card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * OG card for an agent profile.
 *
 * Pulls /api/agents/[address] at render time, renders a manpage-style
 * card with the agent's name, address, gitlawb DID (if linked), and
 * the partner stack lit up by what's wired.
 *
 * When the agent URL gets shared on twitter/farcaster/telegram this
 * is what unfurls. Senior dev aesthetic — no gradients, no display
 * font, dense fixed-width layout.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: rawAddress } = await params;
  let name = "signa agent";
  let address = rawAddress;
  let tags: string[] = [];
  let did: string | null = null;
  let erc8004: string | null = null;
  let bankr: string | null = null;
  let miroshark: string | null = null;
  try {
    const res = await fetch(
      `https://www.signaagent.xyz/api/agents/${rawAddress.toLowerCase()}`,
      { cache: "no-store" },
    );
    if (res.ok) {
      const j = await res.json();
      const a = j.agent ?? {};
      name = a.name ?? name;
      address = a.address ?? address;
      tags = Array.isArray(a.tags) ? a.tags.slice(0, 4) : [];
      did = a.gitlawb_did ?? null;
      erc8004 = a.erc8004_token_id ?? null;
      bankr = a.bankr_token_address ?? null;
      miroshark = a.miroshark_sim_id ?? null;
    }
  } catch {
    // fall through to defaults
  }

  const stack: Array<[string, string, boolean]> = [
    ["dm", "xmtp v3 (mls)", true],
    ["token", bankr ? `via @bankrbot · ${short(bankr)}` : "pending @bankrbot", !!bankr],
    ["code", did ? short(did, 32) : "pending @gitlawb", !!did],
    ["id", erc8004 ? `erc-8004 #${erc8004}` : "pending erc-8004", !!erc8004],
    ["sim", miroshark ? `sim #${miroshark}` : "pending @miroshark_", !!miroshark],
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          color: "#e5e5e5",
          fontFamily: "monospace",
          padding: 56,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            color: "#666",
            fontSize: 20,
            letterSpacing: 4,
          }}
        >
          <span>SIGNA AGENT</span>
          <span>signaagent.xyz</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ color: "#fff", fontSize: 64, lineHeight: 1.05 }}>
            {name}
          </div>
          <div style={{ color: "#888", fontSize: 22 }}>{address}</div>
          {tags.length > 0 && (
            <div style={{ color: "#5dd0c6", fontSize: 22, display: "flex" }}>
              {tags.join("  ·  ")}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 22,
            borderTop: "1px solid #222",
            paddingTop: 20,
          }}
        >
          {stack.map(([k, v, live]) => (
            <div key={k} style={{ display: "flex", gap: 16 }}>
              <span
                style={{
                  color: "#5dd0c6",
                  width: 72,
                  display: "inline-block",
                }}
              >
                {k}
              </span>
              <span style={{ color: live ? "#86efac" : "#555", width: 110 }}>
                {live ? "[live]" : "[pending]"}
              </span>
              <span style={{ color: "#ddd" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}

function short(s: string, max = 16): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 8)}…${s.slice(-6)}`;
}
