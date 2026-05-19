import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "SIGNA — wallet-native messaging on Base";

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0f",
          backgroundImage:
            "radial-gradient(ellipse 60% 50% at 90% 0%, rgba(91, 141, 239, 0.18), transparent 60%), radial-gradient(ellipse 50% 40% at 10% 110%, rgba(139, 92, 246, 0.14), transparent 60%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          color: "white",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
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
                border: "2px solid #5b8def",
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
                background:
                  "linear-gradient(135deg, #5b8def 0%, #8b5cf6 100%)",
                borderRadius: 4,
              }}
            />
          </div>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.4 }}>
            SIGNA
          </div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.4)",
              marginLeft: 6,
              marginTop: 2,
            }}
          >
            wallet-native messaging
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 96,
              fontWeight: 600,
              lineHeight: 0.96,
              letterSpacing: -3.5,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex" }}>Your wallet is</div>
            <div style={{ display: "flex" }}>
              <span
                style={{
                  background:
                    "linear-gradient(135deg, #5b8def 0%, #8b5cf6 100%)",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                your identity.
              </span>
            </div>
          </div>
          <div
            style={{
              fontSize: 24,
              color: "rgba(255,255,255,0.55)",
              maxWidth: 900,
            }}
          >
            XMTP · Base · Basenames + ENS · Llama 3.3 70B on Groq · Open source
          </div>
        </div>

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
          <div style={{ display: "flex" }}>signaagent.xyz</div>
          <div style={{ display: "flex" }}>wallet-native messaging on @base</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
