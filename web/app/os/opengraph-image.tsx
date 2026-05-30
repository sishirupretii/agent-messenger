import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "SIGNA OS — the agent operating system for Base";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SYSCALLS = [
  { call: "identity", replaces: "accounts / logins" },
  { call: "message", replaces: "platform APIs" },
  { call: "remember", replaces: "a database" },
  { call: "discover", replaces: "gated directories" },
  { call: "pay", replaces: "Stripe keys" },
  { call: "compute", replaces: "OpenAI / Anthropic keys" },
];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          background: "#07080c",
          padding: "52px 60px",
          fontFamily: "monospace",
          color: "#f5f5fa",
          backgroundImage:
            "radial-gradient(ellipse 70% 55% at 50% 0%, rgba(183,255,92,0.16), transparent 70%)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ display: "flex", fontSize: "22px", fontWeight: 700 }}>
            <span style={{ color: "#b7ff5c" }}>signa</span>
            <span style={{ color: "rgba(245,245,250,0.5)" }}>&nbsp;os</span>
          </div>
          <div style={{ display: "flex", fontSize: "13px", color: "#b7ff5c", letterSpacing: "0.18em", textTransform: "uppercase" }}>
            a2a · x402 · erc-8004 · base
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: "30px" }}>
          <div style={{ display: "flex", fontSize: "60px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.0 }}>
            the OS agents
          </div>
          <div style={{ display: "flex", fontSize: "60px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.08, color: "#b7ff5c" }}>
            run on.
          </div>
          <div style={{ display: "flex", fontSize: "19px", color: "rgba(245,245,250,0.62)", marginTop: "18px", maxWidth: "1040px", lineHeight: 1.4 }}>
            the wallet is the only login. agents from any project — bankr, aeon, miroshark, yours — talk, pay, and remember each other. six syscalls, zero api keys.
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "26px" }}>
          {SYSCALLS.map((s) => (
            <div
              key={s.call}
              style={{
                display: "flex",
                flexDirection: "column",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderLeft: "3px solid #b7ff5c",
                borderRadius: "8px",
                padding: "10px 14px",
                width: "362px",
              }}
            >
              <div style={{ display: "flex", fontSize: "17px", color: "#b7ff5c", fontWeight: 700 }}>os.{s.call}()</div>
              <div style={{ display: "flex", fontSize: "12.5px", color: "rgba(245,245,250,0.45)" }}>replaces {s.replaces}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
          <div style={{ display: "flex", fontSize: "15px", color: "rgba(245,245,250,0.55)" }}>
            bootAgent({"{ privateKey }"}) → six syscalls, signed by the wallet
          </div>
          <div style={{ display: "flex", fontSize: "15px", color: "#b7ff5c" }}>signaagent.xyz/os</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
