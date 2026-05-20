import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me/bankr-status?address=0x...
 *
 * Lightweight read used by the CLI (`signa bankr status`) and the
 * web settings panel to tell whether a wallet has connected a Bankr
 * Agent API key.
 *
 * Does NOT decrypt or return the key. Just `connected: true|false`.
 * Public read by design — the only fact exposed is whether an address
 * has *any* encrypted key on record, which is already implicit in the
 * fact that `/api/me/trade` would 412 vs 400 for the same wallet.
 * Adding this dedicated endpoint just lets clients check without
 * having to send a signed payload + parse error codes.
 */
export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get("address") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("users")
    .select("bankr_api_key_encrypted")
    .eq("address", address)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    address,
    connected: !!data?.bankr_api_key_encrypted,
  });
}
