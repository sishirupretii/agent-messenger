import { ImageResponse } from "next/og";
import { gradientFor } from "@/lib/gradient";

// Edge runtime is faster for OG images and avoids cold-start issues.
export const runtime = "edge";

export const alt = "DM on SIGNA";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * 1200×630 OG card for /dm/<handle> share links.
 *
 * Renders entirely from the handle param — no internal API calls, no
 * `headers()`, no `next/headers` import. Keeps this generator fast and
 * crash-proof. Address recovery / display-name resolution can happen
 * later inside the actual /dm landing page; the card just needs to
 * look right when shared.
 *
 * next/og requires every container with multiple children to use
 * `display: "flex"`. Don't change that without re-testing.
 */
export default async function DmOgImage({
  params,
}: {
  params: { handle: string };
}) {
  const handle = decodeURIComponent(params.handle ?? "");
  const display = handle.length > 28 ? handle.slice(0, 28) + "…" : handle;
  // Seed the avatar from the handle so the card works for any handle
  // even before resolution. After click-through, the in-app avatar
  // uses the resolved address — the gradient stays close because both
  // hashes are over the same lowercased handle.
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
        {/* TOP: SIGNA wordmark + prompt */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em" }}>
            <span style={{ color: "#5b8def" }}>S</span>
            <span style={{ color: "#8b5cf6" }}>IGNA</span>
          </div>
          <div style={{ display: "flex", opacity: 0.35, fontSize: 22 }}>·</div>
          <div style={{ display: "flex", color: "#5b8def", fontSize: 22 }}>
            $ signa dm {display}
          </div>
        </div>

        {/* CENTER: avatar + handle */}
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
              wallet-native DM · encrypted over XMTP V3
            </div>
          </div>
        </div>

        {/* BOTTOM: CTA + watermark */}
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
              DM them on SIGNA →
            </div>
            <div style={{ display: "flex", opacity: 0.5, fontSize: 22 }}>
              encrypted · wallet-signed · on base
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
