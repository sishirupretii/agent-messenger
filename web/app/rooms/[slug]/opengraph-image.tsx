import { ImageResponse } from "next/og";
import { getRoomBadges } from "@/lib/room-badges";

export const runtime = "edge";
export const alt = "signa room card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Dynamic OG card for /rooms/[slug].
 *
 * Pulls the room metadata + recent message count from the public APIs
 * at render time, then renders a manpage-style card with the room
 * name, slug, partner badge, creator, and message count.
 *
 * Shared on X / Farcaster / Telegram, this unfurls into a rich preview
 * that makes every link recruit visitors.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let name = `#${slug}`;
  let description = "wallet-signed room on the signa network";
  let creator = "";
  let gateTokenAddress: string | null = null;
  let gateSymbol: string | null = null;
  let messageCount = 0;

  try {
    const [roomRes, msgRes] = await Promise.all([
      fetch(`https://www.signaagent.xyz/api/rooms/${slug}`, {
        cache: "no-store",
      }),
      fetch(`https://www.signaagent.xyz/api/rooms/${slug}/messages?limit=200`, {
        cache: "no-store",
      }),
    ]);
    if (roomRes.ok) {
      const j = (await roomRes.json()) as {
        ok: boolean;
        room?: {
          name?: string;
          description?: string;
          creator_address?: string;
          gate_token_address?: string | null;
          gate_token_symbol?: string | null;
        };
      };
      if (j.ok && j.room) {
        name = j.room.name ?? name;
        description = j.room.description ?? description;
        creator = j.room.creator_address ?? "";
        gateTokenAddress = j.room.gate_token_address ?? null;
        gateSymbol = j.room.gate_token_symbol ?? null;
      }
    }
    if (msgRes.ok) {
      const m = (await msgRes.json()) as { ok: boolean; count?: number };
      if (m.ok) messageCount = m.count ?? 0;
    }
  } catch {
    // fall through to defaults
  }

  const badges = getRoomBadges({ slug, gate_token_address: gateTokenAddress });
  const badgeTone =
    badges[0]?.tone === "cyan"
      ? "#9ad7ff"
      : badges[0]?.tone === "magenta"
        ? "#ff7ed1"
        : "#b7ff5c";

  const shortCreator =
    creator.length >= 10 ? `${creator.slice(0, 6)}…${creator.slice(-4)}` : creator;

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
          <div style={{ display: "flex" }}>SIGNA ROOM</div>
          <div style={{ display: "flex" }}>signaagent.xyz/rooms/{slug}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ color: "#fff", fontSize: 60, lineHeight: 1.05 }}>
              {name}
            </div>
            {badges[0] && (
              <div
                style={{
                  display: "flex",
                  fontSize: 18,
                  color: badgeTone,
                  border: `1px solid ${badgeTone}66`,
                  padding: "6px 12px",
                  letterSpacing: 3,
                  textTransform: "uppercase",
                }}
              >
                {badges[0].label}
              </div>
            )}
          </div>
          <div
            style={{
              color: "#aaa",
              fontSize: 22,
              lineHeight: 1.4,
              maxWidth: 1000,
            }}
          >
            {description.slice(0, 200)}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 22,
            borderTop: "1px solid #222",
            paddingTop: 20,
          }}
        >
          <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
            <div style={{ color: "#5dd0c6", width: 140, display: "flex" }}>
              messages
            </div>
            <div style={{ color: "#86efac", display: "flex" }}>
              {messageCount} signed
            </div>
          </div>
          {shortCreator && (
            <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
              <div style={{ color: "#5dd0c6", width: 140, display: "flex" }}>
                creator
              </div>
              <div style={{ color: "#ddd", display: "flex" }}>{shortCreator}</div>
            </div>
          )}
          {gateSymbol && (
            <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
              <div style={{ color: "#5dd0c6", width: 140, display: "flex" }}>
                hold-to-chat
              </div>
              <div style={{ color: badgeTone, display: "flex" }}>
                ${gateSymbol}
              </div>
            </div>
          )}
        </div>
      </div>
    ),
    { ...size },
  );
}
