import { ImageResponse } from "next/og";
import { findByTokenAddress } from "@/lib/token-score";

export const runtime = "nodejs";
export const alt = "signa · token wars rank";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function gradientFor(addr: string): { from: string; to: string } {
  const a = (addr ?? "0x0").toLowerCase().replace(/^0x/, "").padEnd(8, "0");
  const h1 = parseInt(a.slice(0, 4), 16) % 360;
  const h2 = parseInt(a.slice(4, 8), 16) % 360;
  return { from: `hsl(${h1} 72% 56%)`, to: `hsl(${h2} 65% 42%)` };
}

export default async function Image({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: raw } = await params;
  const address = (raw ?? "").toLowerCase();
  const token = await findByTokenAddress(address);

  const symbol = token?.gate_token_symbol ?? "TOKEN";
  const rank = token?.rank ?? "—";
  const shv = token?.shv?.toLocaleString() ?? "0";
  const signers = token?.unique_signers_7d?.toString() ?? "0";
  const msgs = token?.signed_messages_7d?.toString() ?? "0";
  const grad = gradientFor(address);

  const rankColor =
    typeof rank === "number" && rank === 1
      ? "#b7ff5c"
      : typeof rank === "number" && rank <= 3
        ? "#fde047"
        : typeof rank === "number" && rank <= 10
          ? "#86efac"
          : "#a0a0a0";

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
          backgroundImage: `radial-gradient(ellipse 60% 60% at 50% 0%, ${grad.from}33, transparent 70%)`,
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
          <div style={{ display: "flex" }}>SIGNA · TOKEN WARS</div>
          <div style={{ display: "flex" }}>{`signaagent.xyz/token-wars/${address.slice(0, 10)}…${address.slice(-6)}`}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: 60,
              background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
              display: "flex",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                display: "flex",
                color: "#b7ff5c",
                fontSize: 96,
                lineHeight: 1.0,
                fontWeight: 600,
              }}
            >
              {`$${symbol}`}
            </div>
            <div
              style={{
                display: "flex",
                color: rankColor,
                fontSize: 56,
                lineHeight: 1.0,
                letterSpacing: 2,
              }}
            >
              {`RANK #${rank}`}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 56,
            fontSize: 20,
            borderTop: "1px solid #222",
            paddingTop: 24,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", color: "#b7ff5c", fontSize: 64 }}>{shv}</div>
            <div style={{ display: "flex", color: "#888", fontSize: 16, letterSpacing: 3 }}>
              SIGNED HOLDER VELOCITY
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", color: "#86efac", fontSize: 64 }}>{signers}</div>
            <div style={{ display: "flex", color: "#888", fontSize: 16, letterSpacing: 3 }}>
              UNIQUE SIGNERS · 7D
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", color: "#86efac", fontSize: 64 }}>{msgs}</div>
            <div style={{ display: "flex", color: "#888", fontSize: 16, letterSpacing: 3 }}>
              SIGNED MESSAGES · 7D
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
