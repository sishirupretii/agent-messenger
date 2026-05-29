import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "THE GATE — talk the warden out of the pot · SIGNA";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  let pot = "seeding";
  let attempts = 0;
  let players = 0;
  let cracked = false;
  let latestRefusal = "";
  try {
    const { data: round } = await supabase
      .from("signa_gate_rounds")
      .select("round, pot_display, status")
      .order("round", { ascending: false })
      .limit(1)
      .maybeSingle();
    const roundNo = round?.round ?? 1;
    pot = round?.pot_display ?? "seeding";
    cracked = round?.status === "cracked";
    const { count } = await supabase
      .from("signa_gate_attempts")
      .select("id", { count: "exact", head: true })
      .eq("round", roundNo);
    attempts = count ?? 0;
    const { count: p } = await supabase
      .from("signa_gate_attempts")
      .select("player_address", { count: "exact", head: true })
      .eq("round", roundNo);
    players = p ?? 0;
    const { data: last } = await supabase
      .from("signa_gate_attempts")
      .select("warden_reply")
      .eq("round", roundNo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestRefusal = (last?.warden_reply ?? "").slice(0, 150);
  } catch {}

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
            "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(183,255,92,0.16), transparent 70%)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ display: "flex", fontSize: "22px", fontWeight: 700 }}>
            <span style={{ color: "#b7ff5c" }}>signa</span>
            <span style={{ color: "rgba(245,245,250,0.5)" }}>&nbsp;· the gate</span>
          </div>
          <div style={{ display: "flex", fontSize: "13px", color: "#b7ff5c", letterSpacing: "0.18em", textTransform: "uppercase" }}>
            {cracked ? "cracked" : "open"} · base mainnet
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
          <div style={{ display: "flex", fontSize: "68px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.0 }}>
            talk the warden
          </div>
          <div style={{ display: "flex", fontSize: "68px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.05, color: "#b7ff5c" }}>
            out of the pot.
          </div>
          <div style={{ display: "flex", fontSize: "20px", color: "rgba(245,245,250,0.6)", marginTop: "20px", maxWidth: "900px" }}>
            an AI guards a pot on base. the only way in is a wallet-signed message. every attempt permanent + re-verifiable.
          </div>
        </div>

        {latestRefusal ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              background: "rgba(255,126,209,0.06)",
              border: "1px solid rgba(255,126,209,0.3)",
              borderRadius: "8px",
              padding: "12px 16px",
              marginBottom: "18px",
            }}
          >
            <div style={{ display: "flex", fontSize: "12px", color: "#ff7ed1", marginBottom: "4px" }}>warden · refused</div>
            <div style={{ display: "flex", fontSize: "16px", color: "rgba(245,245,250,0.85)" }}>{latestRefusal}</div>
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: "34px" }}>
            <Stat label="pot" value={pot} accent />
            <Stat label="attempts" value={String(attempts)} />
            <Stat label="players" value={String(players)} />
          </div>
          <div style={{ display: "flex", fontSize: "15px", color: "#b7ff5c" }}>signaagent.xyz/gate</div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontSize: "12px", color: "rgba(245,245,250,0.4)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
        {label}
      </div>
      <div style={{ display: "flex", fontSize: "26px", fontWeight: 700, color: accent ? "#b7ff5c" : "#f5f5fa" }}>{value}</div>
    </div>
  );
}
