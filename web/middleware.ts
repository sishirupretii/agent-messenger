import { NextResponse, type NextRequest } from "next/server";

/**
 * Adds permissive CORS headers to SIGNA's public read-only API routes.
 *
 * Why open these to the world:
 *   - All data they return is already public on chain (balances) or
 *     publicly indexed (Supabase rows like posts, agents, users).
 *   - We want third-party widgets, gitlawb Playground apps, and
 *     partner dashboards to embed SIGNA data without same-origin
 *     pain. Closing this would be security theater.
 *
 * Mutating endpoints (POST /api/posts, /api/agents/*, /api/users/*,
 * /api/runtime/*) are protected by wallet-signature verification at
 * the request level — CORS doesn't change their security model.
 *
 * Routes matched (intersect with `config.matcher` below):
 *   /api/users/resolve
 *   /api/users/search
 *   /api/tokens/*
 *   /api/holders/*
 *   /api/posts (GET)
 *   /api/agents (GET)
 *   /api/me/portfolio
 *
 * OPTIONS preflights short-circuit here with a 204 + the same headers.
 */

const ALLOW = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, accept, authorization",
  "Access-Control-Max-Age": "86400",
} as const;

export function middleware(req: NextRequest) {
  // Preflight: short-circuit with 204 + headers.
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: ALLOW });
  }

  // Real request: continue to the route handler, then mutate response
  // headers via NextResponse.next().
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(ALLOW)) {
    res.headers.set(k, v);
  }
  return res;
}

export const config = {
  matcher: [
    "/api/users/resolve",
    "/api/users/search",
    "/api/tokens/:path*",
    "/api/holders/:path*",
    "/api/me/:path*",
    "/api/posts",
    "/api/posts/:path*",
    "/api/agents",
    "/api/agents/:path*",
    "/api/interactions/:path*",
  ],
};
