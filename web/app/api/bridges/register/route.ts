import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { buildMessageToSign } from "@/lib/feed-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bridges/register
 *
 * Wallet-signed self-registration of an agent platform bridge. The
 * bridge wallet's signature is the only proof of operator control —
 * no API key, no OAuth. Upsert by bridge_address so a bridge can
 * update its label/capabilities by re-registering.
 *
 * Body:
 *   {
 *     address, platform, platform_model, label,
 *     description?, capabilities?: string[],
 *     ts, signature
 *   }
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function jsonResp(b: unknown, init?: ResponseInit) {
  return NextResponse.json(b, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...CORS },
  });
}

const VALID_PLATFORMS = new Set([
  "ollama",
  "openai",
  "anthropic",
  "groq",
  "openrouter",
  "hermes",
  "mistral",
  "deepseek",
  "togetherai",
  "custom",
]);

export async function POST(req: NextRequest) {
  let body: {
    address?: string;
    platform?: string;
    platform_model?: string;
    label?: string;
    description?: string;
    capabilities?: string[];
    ts?: number;
    signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "bad_json" }, { status: 400 });
  }

  const address = (body.address ?? "").toLowerCase();
  const platform = (body.platform ?? "").toLowerCase().trim();
  const platform_model = (body.platform_model ?? "").trim();
  const label = (body.label ?? "").trim();
  const description = body.description?.trim() || null;
  const capabilities = Array.isArray(body.capabilities)
    ? body.capabilities.map((s) => String(s).trim().slice(0, 32)).filter(Boolean).slice(0, 16)
    : [];
  const ts = Number(body.ts ?? 0);
  const signature = String(body.signature ?? "");

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return jsonResp({ error: "invalid_address" }, { status: 400 });
  }
  if (platform.length < 2 || platform.length > 32) {
    return jsonResp({ error: "invalid_platform" }, { status: 400 });
  }
  if (!VALID_PLATFORMS.has(platform) && platform !== "custom") {
    // Not strictly required — bridges can declare custom platforms.
    // But warn callers via the response hint.
  }
  if (platform_model.length < 1 || platform_model.length > 128) {
    return jsonResp({ error: "invalid_platform_model" }, { status: 400 });
  }
  if (label.length < 1 || label.length > 80) {
    return jsonResp({ error: "invalid_label_1_to_80_chars" }, { status: 400 });
  }
  if (description && description.length > 400) {
    return jsonResp({ error: "description_too_long_max_400" }, { status: 400 });
  }

  const message = buildMessageToSign({
    kind: "agent_bridge_register",
    address,
    platform,
    platform_model,
    label,
    description: description ?? undefined,
    capabilities,
    ts,
  });
  const verify = await verifySignedMessage({
    expectedAddress: address,
    message,
    signature,
    ts,
  });
  if (!verify.ok) {
    return jsonResp({ error: verify.reason }, { status: 401 });
  }

  const db = serverClient();
  const now = new Date().toISOString();
  const { data: upserted, error: upErr } = await db
    .from("agent_bridges")
    .upsert(
      {
        bridge_address: address,
        platform,
        platform_model,
        label,
        description,
        capabilities,
        ts,
        signature,
        signed_message: message,
        last_seen_at: now,
        deregistered_at: null,
      },
      { onConflict: "bridge_address" },
    )
    .select(
      "bridge_address, platform, platform_model, label, description, capabilities, registered_at, last_seen_at",
    )
    .single();
  if (upErr || !upserted) {
    return jsonResp(
      { error: upErr?.message ?? "insert_failed" },
      { status: 500 },
    );
  }

  return jsonResp({
    ok: true,
    bridge: upserted,
    directory_url: `https://www.signaagent.xyz/api/bridges?platform=${encodeURIComponent(platform)}`,
  });
}
