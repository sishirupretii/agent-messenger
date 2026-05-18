/**
 * Deterministic 2-stop gradient derived from an address (or any seed).
 * Shared between the client GradientAvatar component and server-rendered
 * OG image cards so the avatar on a /u/<handle> share matches what
 * visitors see when they click through.
 *
 * Palette biased toward the SIGNA blue/violet/cyan accent system.
 */

export type GradientStops = {
  hueA: number;
  hueB: number;
  angle: number;
  /** seed-derived inner-circle position + radius for some personality */
  ix: number;
  iy: number;
  ir: number;
};

export function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function gradientFor(seed: string | null | undefined): GradientStops {
  const safe = (seed ?? "anon").toLowerCase();
  const h = djb2(safe);
  return {
    hueA: 200 + (h % 60),
    hueB: 230 + ((h >>> 7) % 70),
    angle: (h >>> 13) % 360,
    ix: 8 + ((h >>> 19) % 16),
    iy: 8 + ((h >>> 24) % 16),
    ir: 3 + ((h >>> 27) % 4),
  };
}
