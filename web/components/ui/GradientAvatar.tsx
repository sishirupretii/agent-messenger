import { cn } from "@/lib/cn";

/**
 * Deterministic 2-stop gradient avatar derived from an address (or any seed
 * string). Palette is biased toward the SIGNA blue/violet accent system so
 * avatars feel native to the product rather than randomly colored.
 *
 * - Stable: same address → same gradient, every render
 * - Stop A: hue 200–260 (blues + violets)
 * - Stop B: hue 240–300 (violets + pinks), rotated from A
 * - Both fairly saturated, mid-bright
 */
export function GradientAvatar({
  seed,
  size = 32,
  className,
}: {
  seed: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const safeSeed = (seed ?? "anon").toLowerCase();
  const h = djb2(safeSeed);
  const hueA = 200 + (h % 60);                  // 200–259  (cyan→violet)
  const hueB = 230 + ((h >>> 7) % 70);           // 230–299  (blue→pink)
  const angle = (h >>> 13) % 360;
  const id = `g-${safeSeed.slice(2, 12)}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("rounded-full overflow-hidden flex-shrink-0 block", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <defs>
        <linearGradient
          id={id}
          gradientTransform={`rotate(${angle}, 0.5, 0.5)`}
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop offset="0%" stopColor={`hsl(${hueA} 75% 58%)`} />
          <stop offset="100%" stopColor={`hsl(${hueB} 80% 52%)`} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="16" fill={`url(#${id})`} />
      {/* subtle interior shape for some character */}
      <circle
        cx={8 + ((h >>> 19) % 16)}
        cy={8 + ((h >>> 24) % 16)}
        r={3 + ((h >>> 27) % 4)}
        fill="rgba(255,255,255,0.18)"
      />
    </svg>
  );
}

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}
