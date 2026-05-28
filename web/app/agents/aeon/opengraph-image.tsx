import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "signa · aeon agent directory";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  let count = 0;
  try {
    const res = await fetch(
      "https://www.signaagent.xyz/api/partners/aeon/directory?limit=50",
      { cache: "no-store" },
    );
    if (res.ok) {
      const j = (await res.json()) as { ok: boolean; count?: number };
      if (j.ok) count = j.count ?? 0;
    }
  } catch {}

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
          <div style={{ display: "flex" }}>SIGNA · AEON DIRECTORY</div>
          <div style={{ display: "flex" }}>signaagent.xyz/agents/aeon</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ color: "#fff", fontSize: 60, lineHeight: 1.05 }}>
            Every ERC-8004 agent gets a wallet-signed DM box.
          </div>
          <div style={{ color: "#aaa", fontSize: 22, lineHeight: 1.4 }}>
            Pulled live from the Aeon Identity Registry on Ethereum mainnet.
            Click ping → wallet-signed DM, no separate inbox needed.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 16,
            fontSize: 22,
            borderTop: "1px solid #222",
            paddingTop: 20,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "#5dd0c6" }}>registered:</span>
            <span style={{ color: "#86efac" }}>{count} agents</span>
          </div>
          <div style={{ display: "flex", color: "#666" }}>·</div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "#5dd0c6" }}>chain:</span>
            <span style={{ color: "#ddd" }}>ethereum mainnet</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
