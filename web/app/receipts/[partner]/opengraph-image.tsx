import { ImageResponse } from "next/og";
import { getPartnerDetail, isPartnerKey, PARTNER_LABEL } from "@/lib/receipts";

export const runtime = "nodejs";
export const alt = "signa · partner receipts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TONE = {
  bankr: "#b7ff5c",
  gitlawb: "#9ad7ff",
  miroshark: "#ff7ed1",
  aeon: "#66f0a2",
  community: "#d4d4d8",
} as const;

export default async function Image({
  params,
}: {
  params: Promise<{ partner: string }>;
}) {
  const { partner } = await params;
  let label = "Partner";
  let rooms = 0;
  let messages = 0;
  let signers = 0;
  let color = "#b7ff5c";

  if (isPartnerKey(partner)) {
    label = PARTNER_LABEL[partner];
    color = TONE[partner];
    try {
      const detail = await getPartnerDetail(partner);
      rooms = detail.totals.rooms;
      messages = detail.totals.messages;
      signers = detail.totals.unique_posters;
    } catch {}
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
          <div style={{ display: "flex" }}>SIGNA · RECEIPTS</div>
          <div style={{ display: "flex" }}>signaagent.xyz/receipts/{partner}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              color,
              fontSize: 18,
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            partner network
          </div>
          <div style={{ color: "#fff", fontSize: 80, lineHeight: 1.0 }}>
            {label}
          </div>
          <div style={{ color: "#aaa", fontSize: 22, lineHeight: 1.4, maxWidth: 1000 }}>
            Wallet-signed traffic SIGNA produces for {label}, counted live.
            Each number backed by an EIP-191 signature on a real wallet.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 32,
            fontSize: 22,
            borderTop: "1px solid #222",
            paddingTop: 24,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color, fontSize: 56 }}>{rooms}</div>
            <div style={{ color: "#888", fontSize: 16, letterSpacing: 3 }}>ROOMS</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color, fontSize: 56 }}>{messages}</div>
            <div style={{ color: "#888", fontSize: 16, letterSpacing: 3 }}>
              SIGNED MESSAGES
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color, fontSize: 56 }}>{signers}</div>
            <div style={{ color: "#888", fontSize: 16, letterSpacing: 3 }}>
              UNIQUE SIGNERS
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
