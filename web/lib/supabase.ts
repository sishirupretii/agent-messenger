import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client factories. Both creation paths are lazy — env is
 * read on first use, not at module load — so route handlers that don't
 * actually touch Supabase can still be statically analyzed by Next's
 * "collect page data" pass without env present (e.g. during a local
 * build without .env.local). Vercel deploys always have the env set.
 */

let _browser: SupabaseClient | null = null;
let _server: SupabaseClient | null = null;

function readEnv(): { url: string; anon: string; service: string | undefined } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — set these in your environment before calling Supabase.",
    );
  }
  return { url, anon, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
}

/**
 * Browser-safe Supabase client. Reads everything via RLS-allowed selects.
 * Never used for writes from the browser — writes go through Next.js API
 * routes which verify wallet signatures first.
 */
export const supabase: SupabaseClient = new Proxy(
  {} as SupabaseClient,
  {
    get(_t, prop) {
      if (!_browser) {
        const { url, anon } = readEnv();
        _browser = createClient(url, anon, {
          auth: { persistSession: false },
        });
      }
      const v = (_browser as unknown as Record<string | symbol, unknown>)[prop];
      return typeof v === "function" ? v.bind(_browser) : v;
    },
  },
);

/**
 * Server-side client. Same anon key for now (v1 tradeoff: a determined
 * caller could write directly to Supabase REST and bypass our signature
 * verification — RLS only enforces shape constraints). To lock down, set
 * SUPABASE_SERVICE_ROLE_KEY in Vercel env and this factory will pick it
 * up automatically.
 */
export function serverClient(): SupabaseClient {
  if (!_server) {
    const { url, anon, service } = readEnv();
    _server = createClient(url, service || anon, {
      auth: { persistSession: false },
    });
  }
  return _server;
}
