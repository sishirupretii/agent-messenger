import { ImageResponse } from "next/og";
import { headers } from "next/headers";
import { gradientFor } from "@/lib/gradient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const alt = "DM on SIGNA";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type ResolvedUser = {
  ok: true;
  address: string;
  basename: string | null;
  ens_name: string | null;
};

async function resolveHandle(handle: string): Promise<ResolvedUser | null> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("host") || "www.signaagent.xyz";
  try {
    const res = await fetch(
      `${proto}://${host}/api/users/resolve?handle=${encodeURIComponent(handle)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const j = await res.json();
    if (!j.ok) return null;
    return j as ResolvedUser;
  } catch {
    return null;
  }
}

export default async function DmOgImage({
  params,
}: {
  params: { handle: string };
}) {
  const handle = decodeURIComponent(params.handle);
  const resolved = await resolveHandle(handle);
  const address = resolved?.address ?? handle;
  const display =
    resolved?.basename ?? resolved?.ens_name ?? handle;

  // Truncate display for the card
  const displayShort = display.length > 28 ? display.slice(0, 28) + "…" : display;
  const g = gradientFor(address);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0a0a0f",
          color: "white",
          fontFamily: "monospace",
          padding: "72px 80px",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        {/* top row — signa wordmark + prompt */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 24,
          }}
        >
          <div
            style={{
              fontWeight: 700,
              letterSpacing: "-0.02em",
              fontSize: 30,
              fontFamily: "system-ui",
              display: "flex",
            }}
          >
            <span style={{ color: "#5b8def" }}>S</span>
            <span style={{ color: "#8b5cf6" }}>IGNA</span>
          </div>
          <span style={{ opacity: 0.4, fontSize: 18 }}>·</span>
          <span style={{ color: "#5b8def", fontSize: 20 }}>
            $ signa dm {displayShort}
          </span>
        </div>

        {/* center — avatar + handle */}
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <svg width="180" height="180" viewBox="0 0 32 32">
            <defs>
              <linearGradient
                id="g"
                gradientTransform={`rotate(${g.angle}, 0.5, 0.5)`}
                x1="0"
                y1="0"
                x2="1"
                y2="1"
              >
                <stop offset="0%" stopColor={`hsl(${g.hueA} 75% 58%)`} />
                <stop offset="100%" stopColor={`hsl(${g.hueB} 80% 52%)`} />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="16" fill="url(#g)" />
            <circle
              cx={g.ix}
              cy={g.iy}
              r={g.ir}
              fill="rgba(255,255,255,0.22)"
            />
          </svg>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              maxWidth: 760,
            }}
          >
            <div
              style={{
                fontSize: 76,
                fontWeight: 700,
                letterSpacing: "-0.04em",
                lineHeight: 1,
                fontFamily: "system-ui",
                wordBreak: "break-all",
              }}
            >
              {displayShort}
            </div>
            <div style={{ fontSize: 20, opacity: 0.5 }}>
              {address.slice(0, 12)}…{address.slice(-6)}
            </div>
          </div>
        </div>

        {/* bottom — CTA + receipt */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: 22,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 36,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                fontFamily: "system-ui",
              }}
            >
              DM them on SIGNA →
            </div>
            <div style={{ opacity: 0.55 }}>
              encrypted · wallet-signed · on base
            </div>
          </div>
          <div
            style={{
              opacity: 0.4,
              fontSize: 18,
              fontFamily: "monospace",
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
