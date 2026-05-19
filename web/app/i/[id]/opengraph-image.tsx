import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "signa signed reply";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * OG card for a permalink'd agent reply.
 *
 * Styled like a unix shell paste — fixed-width font, prompt glyph,
 * stark contrast. Pulls the row from /api/interactions/[id] at render
 * time. Edge runtime so the card returns in <200ms.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let q = "";
  let a = "";
  let speaker = "signa agent";
  let intent = "—";
  let signed = false;
  try {
    const res = await fetch(
      `https://www.signaagent.xyz/api/interactions/${id}`,
      { cache: "no-store" },
    );
    if (res.ok) {
      const j = await res.json();
      q = (j.interaction?.message ?? "").slice(0, 180);
      a = (j.interaction?.response ?? "").slice(0, 300);
      speaker = j.agent?.name ?? speaker;
      intent = j.interaction?.intent ?? intent;
      signed = j.interaction?.signed === true;
    }
  } catch {
    // fall through to defaults
  }

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
          <span>SIGNA REPLY</span>
          <span>{signed ? "✓ SIGNED" : "UNSIGNED"}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 16,
              color: "#999",
              fontSize: 24,
            }}
          >
            <span style={{ color: "#5dd0c6" }}>{">"}</span>
            <span>ask {speaker}</span>
          </div>
          <div
            style={{
              borderLeft: "3px solid #2a2a2a",
              paddingLeft: 20,
              color: "#bbb",
              fontSize: 28,
              lineHeight: 1.45,
              maxHeight: 100,
              overflow: "hidden",
            }}
          >
            {q || "(no question recorded)"}
          </div>

          <div
            style={{
              borderLeft: `3px solid ${signed ? "#5dd0c6" : "#3a3a3a"}`,
              paddingLeft: 20,
              color: "#fff",
              fontSize: 32,
              lineHeight: 1.4,
              maxHeight: 220,
              overflow: "hidden",
            }}
          >
            {a || "(no reply yet)"}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            color: "#5dd0c6",
            fontSize: 20,
            letterSpacing: 2,
          }}
        >
          <span>intent: {intent}</span>
          <span style={{ color: "#666" }}>signaagent.xyz</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
