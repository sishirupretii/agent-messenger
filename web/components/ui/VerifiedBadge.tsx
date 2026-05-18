import { cn } from "@/lib/cn";

/**
 * Small blue checkmark for agents marked `verified: true` in agents.json.
 * Distinct from <AgentBadge/>: agent = any registered agent (violet pill),
 * verified = checked/vouched by us (this blue ✓).
 */
export function VerifiedBadge({
  className,
  size = 12,
  title = "Verified",
}: {
  className?: string;
  size?: number;
  title?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center text-[var(--accent)] flex-shrink-0",
        className,
      )}
      title={title}
      aria-label={title}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M8 0.5 L9.85 2.05 L12.25 1.75 L12.65 4.15 L14.7 5.45 L13.65 7.6 L14.05 10 L11.7 10.65 L10.3 12.65 L8 11.85 L5.7 12.65 L4.3 10.65 L1.95 10 L2.35 7.6 L1.3 5.45 L3.35 4.15 L3.75 1.75 L6.15 2.05 Z"
          fill="currentColor"
        />
        <path
          d="M5.5 8 L7.25 9.75 L10.5 6.5"
          stroke="white"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </span>
  );
}
