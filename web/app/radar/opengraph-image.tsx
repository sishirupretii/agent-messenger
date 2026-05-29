import { ImageResponse } from "next/og";
import { buildBoard, CALL_COLORS, type Reading } from "@/lib/signal-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "SIGNA signal desk — autonomous Base momentum board";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Auto-unfurling share card for /radar. When the link is posted on X /
 * Farcaster / Telegram it renders the live momentum board as an image —
 * the shareable artifact the whole agent exists to produce.
 */
function pct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export default async function Image() {
  let board: Reading[] = [];
  try {
    board = await buildBoard({ trendingCount: 5 });
  } catch {
    board = [];
  }
  const rows = board.slice(0, 7);

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          background: "#08090d",
          padding: "44px 52px",
          fontFamily: "monospace",
          color: "#f5f5fa",
        }}
      >
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "22px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: "34px", fontWeight: 700, letterSpacing: "-0.02em" }}>
              <span style={{ color: "#b7ff5c" }}>signa</span>
              <span style={{ color: "#f5f5fa" }}>&nbsp;· signal desk</span>
            </div>
            <div style={{ display: "flex", fontSize: "15px", color: "rgba(245,245,250,0.5)", marginTop: "8px" }}>
              autonomous base momentum board · every reading wallet-signed
            </div>
          </div>
          <div style={{ display: "flex", fontSize: "13px", color: "#b7ff5c", letterSpacing: "0.18em", textTransform: "uppercase" }}>
            live · base mainnet
          </div>
        </div>

        {/* board */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "2px" }}>
          {rows.length === 0 ? (
            <div style={{ display: "flex", color: "rgba(245,245,250,0.5)", fontSize: "20px" }}>
              board warming up…
            </div>
          ) : (
            rows.map((r, i) => (
              <div
                key={r.address}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "11px 16px",
                  background: i % 2 === 0 ? "rgba(255,255,255,0.03)" : "transparent",
                  borderRadius: "6px",
                }}
              >
                <div style={{ display: "flex", width: "34px", fontSize: "16px", color: "rgba(245,245,250,0.35)" }}>
                  {i + 1}
                </div>
                <div style={{ display: "flex", flex: 1, fontSize: "21px", fontWeight: 600 }}>
                  ${r.symbol}
                  {r.pinned ? (
                    <span style={{ display: "flex", fontSize: "12px", color: "#b7ff5c", marginLeft: "12px", alignItems: "center", letterSpacing: "0.14em" }}>
                      PARTNER
                    </span>
                  ) : null}
                </div>
                <div
                  style={{
                    display: "flex",
                    width: "130px",
                    justifyContent: "flex-end",
                    fontSize: "19px",
                    color: (r.change_24h_pct ?? 0) >= 0 ? "#b7ff5c" : "#ff7ed1",
                  }}
                >
                  {pct(r.change_24h_pct)}
                </div>
                <div
                  style={{
                    display: "flex",
                    width: "170px",
                    justifyContent: "flex-end",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      fontSize: "16px",
                      padding: "4px 12px",
                      borderRadius: "6px",
                      border: `1px solid ${CALL_COLORS[r.call]}`,
                      color: CALL_COLORS[r.call],
                      letterSpacing: "0.06em",
                    }}
                  >
                    {r.call.toUpperCase()} {r.score}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* footer */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "20px", fontSize: "14px", color: "rgba(245,245,250,0.45)" }}>
          <div style={{ display: "flex" }}>score = 0.6·momentum + 0.4·turnover · re-verifiable · not advice</div>
          <div style={{ display: "flex", color: "#b7ff5c" }}>signaagent.xyz/radar</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
