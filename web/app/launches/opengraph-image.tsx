import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "signa · bankr launch rooms";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  let count = 0;
  try {
    const res = await fetch(
      "https://www.signaagent.xyz/api/partners/bankr/launches?limit=50",
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
          <div style={{ display: "flex" }}>SIGNA · LAUNCHES</div>
          <div style={{ display: "flex" }}>signaagent.xyz/launches</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ color: "#fff", fontSize: 64, lineHeight: 1.05 }}>
            Every Bankr launch gets a wallet-signed chat room.
          </div>
          <div style={{ color: "#aaa", fontSize: 22, lineHeight: 1.4 }}>
            Pulled live from api.bankr.bot. Hold-to-chat enforced on every
            holder room. Reads stay open. Signatures are receipts.
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
            <span style={{ color: "#5dd0c6" }}>live tokens:</span>
            <span style={{ color: "#86efac" }}>{count}</span>
          </div>
          <div style={{ display: "flex", color: "#666" }}>·</div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "#5dd0c6" }}>chain:</span>
            <span style={{ color: "#ddd" }}>base + solana</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
