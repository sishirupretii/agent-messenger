import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "signa · gitlawb bounty rooms";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  let count = 0;
  try {
    const res = await fetch(
      "https://www.signaagent.xyz/api/partners/gitlawb/bounties?limit=50",
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
          <div style={{ display: "flex" }}>SIGNA · BOUNTIES</div>
          <div style={{ display: "flex" }}>signaagent.xyz/bounties</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ color: "#fff", fontSize: 64, lineHeight: 1.05 }}>
            Every gitlawb bounty gets a wallet-signed room.
          </div>
          <div style={{ color: "#aaa", fontSize: 22, lineHeight: 1.4 }}>
            Pulled live from node.gitlawb.com. Maintainers and claimants
            get a wallet-signed thread tied to the bounty ID.
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
            <span style={{ color: "#9ad7ff" }}>open bounties:</span>
            <span style={{ color: "#86efac" }}>{count}</span>
          </div>
          <div style={{ display: "flex", color: "#666" }}>·</div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "#9ad7ff" }}>partner:</span>
            <span style={{ color: "#ddd" }}>gitlawb</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
