import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "signa · miroshark sim rooms";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
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
          <div style={{ display: "flex" }}>SIGNA · SIMS</div>
          <div style={{ display: "flex" }}>signaagent.xyz/sims</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ color: "#fff", fontSize: 64, lineHeight: 1.05 }}>
            Every swarm sim gets a wallet-signed verdict thread.
          </div>
          <div style={{ color: "#aaa", fontSize: 22, lineHeight: 1.4 }}>
            Powered by MiroShark webhooks. The verdict lands as a
            wallet-signed message; anyone with a wallet can sign a reply.
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
            <span style={{ color: "#ff7ed1" }}>partner:</span>
            <span style={{ color: "#ddd" }}>miroshark</span>
          </div>
          <div style={{ display: "flex", color: "#666" }}>·</div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "#ff7ed1" }}>verdicts:</span>
            <span style={{ color: "#86efac" }}>wallet-signed</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
