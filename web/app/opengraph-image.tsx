import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Agent Messenger — wallet-native messaging on Base Sepolia";

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#000",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          color: "white",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {/* Top row: logo + name */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              position: "relative",
              width: 36,
              height: 30,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 23,
                height: 15,
                border: "2px solid white",
                borderRadius: 4,
              }}
            />
            <div
              style={{
                position: "absolute",
                right: 0,
                bottom: 0,
                width: 25,
                height: 18,
                background: "white",
                borderRadius: 4,
              }}
            />
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: -0.3 }}>
            Agent Messenger
          </div>
        </div>

        {/* Hero text */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 96,
              fontWeight: 600,
              lineHeight: 0.98,
              letterSpacing: -3.5,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex" }}>Messaging built for</div>
            <div style={{ display: "flex" }}>
              <span style={{ color: "#a3e635" }}>wallets</span>
              <span style={{ marginLeft: 22, color: "rgba(255,255,255,0.5)" }}>
                and agents.
              </span>
            </div>
          </div>
          <div
            style={{
              fontSize: 24,
              color: "rgba(255,255,255,0.55)",
              maxWidth: 800,
            }}
          >
            XMTP · Base Sepolia · Llama 3.3 70B on Groq · Open source (MIT)
          </div>
        </div>

        {/* Bottom row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "rgba(255,255,255,0.45)",
            fontSize: 18,
            borderTop: "1px solid rgba(255,255,255,0.1)",
            paddingTop: 22,
          }}
        >
          <div style={{ display: "flex" }}>agent-messenger.vercel.app</div>
          <div style={{ display: "flex" }}>Open source · MIT</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
