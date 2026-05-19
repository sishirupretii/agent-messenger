import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { decryptAgentKey } from "@/lib/key-vault";
import { authorizeBearer } from "@/lib/secret-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal endpoint consumed by the Railway runtime service.
 *
 * GET /api/runtime/agents
 *   Headers: Authorization: Bearer <RUNTIME_FETCH_SECRET>
 *
 * Returns the list of currently-opted-in agents along with the
 * DECRYPTED private key for each (in 0x-prefixed hex). The runtime
 * uses each key to start an XMTP installation for that agent and
 * to sign reply messages.
 *
 * This is the ONLY endpoint that emits plaintext keys. Auth is a
 * shared secret in both Vercel env and Railway env. Rotate by
 * setting the env on both sides and redeploying.
 *
 * The keys never leak to the client — this route is intended for
 * service-to-service only, and would 401 from a browser.
 */
export async function GET(req: NextRequest) {
  if (!process.env.RUNTIME_FETCH_SECRET) {
    return NextResponse.json(
      { error: "runtime_fetch_secret_not_set" },
      { status: 503 },
    );
  }
  // Constant-time check — plain string-equality on the Bearer token
  // leaks the secret byte-by-byte to a timing attacker.
  if (!authorizeBearer(req, "RUNTIME_FETCH_SECRET")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = serverClient();
  const { data, error } = await db
    .from("agents")
    .select(
      "address, name, description, system_prompt, encrypted_key, runtime_enabled_at, runtime_last_seen_at",
    )
    .eq("runtime_enabled", true)
    .is("deleted_at", null)
    .not("encrypted_key", "is", null)
    .order("runtime_enabled_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const agents: Array<{
    address: string;
    name: string;
    description: string;
    system_prompt: string | null;
    private_key: string;
    enabled_at: string | null;
    last_seen_at: string | null;
  }> = [];

  for (const row of data ?? []) {
    if (!row.encrypted_key) continue;
    try {
      const privateKey = decryptAgentKey(row.encrypted_key);
      agents.push({
        address: row.address,
        name: row.name,
        description: row.description,
        system_prompt: row.system_prompt ?? null,
        private_key: privateKey,
        enabled_at: row.runtime_enabled_at,
        last_seen_at: row.runtime_last_seen_at,
      });
    } catch (e) {
      console.error(
        `[runtime/agents] decrypt failed for ${row.address}:`,
        e instanceof Error ? e.message : e,
      );
      // skip — runtime never sees broken keys
    }
  }

  return NextResponse.json({ ok: true, agents });
}

/**
 * POST /api/runtime/agents/heartbeat — Railway service can ping here
 * after handling a DM for an agent so its `runtime_last_seen_at` shows
 * on the profile.
 *
 * Body: { address: string }
 */
export async function POST(req: NextRequest) {
  if (!process.env.RUNTIME_FETCH_SECRET) {
    return NextResponse.json(
      { error: "runtime_fetch_secret_not_set" },
      { status: 503 },
    );
  }
  // Same constant-time path as the GET — see comment above.
  if (!authorizeBearer(req, "RUNTIME_FETCH_SECRET")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const address = (body.address ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  const db = serverClient();
  const { error } = await db
    .from("agents")
    .update({ runtime_last_seen_at: new Date().toISOString() })
    .eq("address", address)
    .eq("runtime_enabled", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
