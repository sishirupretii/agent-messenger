import { ImageResponse } from "next/og";
import { gradientFor } from "@/lib/gradient";

export const runtime = "edge";

export const alt = "Profile on SIGNA";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * 1200×630 OG card for /u/<handle> share links.
 *
 * See /dm/[handle]/opengraph-image.tsx for the layout/flex notes.
 * This card differs only in the bottom-strip copy ('wallet-native
 * profile' instead of 'DM them').
 */
export default async function ProfileOgImage({
  params,
}: {
  params: { handle: string };
}) {
  const handle = decodeURIComponent(params.handle ?? "");
  const display = handle.length > 28 ? handle.slice(0, 28) + "…" : handle;
  const g = gradientFor(handle);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0f",
          color: "white",
          padding: "72px 80px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* TOP */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em" }}>
            <span style={{ color: "#5b8def" }}>S</span>
            <span style={{ color: "#8b5cf6" }}>IGNA</span>
          </div>
          <div style={{ display: "flex", opacity: 0.35, fontSize: 22 }}>·</div>
          <div style={{ display: "flex", color: "#5b8def", fontSize: 22 }}>
            $ signa profile {display}
          </div>
        </div>

        {/* CENTER */}
        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          <svg width="180" height="180" viewBox="0 0 32 32" style={{ display: "flex" }}>
            <defs>
              <linearGradient id="g" gradientTransform={`rotate(${g.angle}, 0.5, 0.5)`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={`hsl(${g.hueA} 75% 58%)`} />
                <stop offset="100%" stopColor={`hsl(${g.hueB} 80% 52%)`} />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="16" fill="url(#g)" />
            <circle cx={g.ix} cy={g.iy} r={g.ir} fill="rgba(255,255,255,0.22)" />
          </svg>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              maxWidth: 800,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 84,
                fontWeight: 700,
                letterSpacing: "-0.04em",
                lineHeight: 1,
                wordBreak: "break-all",
              }}
            >
              {display}
            </div>
            <div style={{ display: "flex", fontSize: 22, opacity: 0.55 }}>
              holdings · launched agents · feed · DM
            </div>
          </div>
        </div>

        {/* BOTTOM */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 40,
                fontWeight: 600,
                letterSpacing: "-0.02em",
              }}
            >
              wallet-native profile on base
            </div>
            <div style={{ display: "flex", opacity: 0.5, fontSize: 22 }}>
              encrypted DMs · partner-token holdings · agents launched
            </div>
          </div>
          <div
            style={{
              display: "flex",
              opacity: 0.4,
              fontSize: 20,
            }}
          >
            signaagent.xyz
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
