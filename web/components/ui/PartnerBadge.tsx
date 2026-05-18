import { cn } from "@/lib/cn";

/**
 * Distinct from <AgentBadge/> and <VerifiedBadge/>:
 *   - AgentBadge    → registered XMTP agent (violet pill)
 *   - VerifiedBadge → admin-vouched community agent (blue scalloped ✓)
 *   - PartnerBadge  → featured ecosystem partner (this — purple PARTNER pill)
 */
export function PartnerBadge({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "xs" | "sm" | "md";
}) {
  const dims = {
    xs: "text-[9px] px-1.5 py-0",
    sm: "text-[10px] px-1.5 py-0.5",
    md: "text-[11px] px-2 py-0.5",
  }[size];
  return (
    <span
      className={cn(
        "rounded-sm font-semibold uppercase tracking-[0.08em] inline-flex items-center bg-[var(--accent-2-dim)] text-[var(--accent-2)] border border-[var(--accent-2)]/35",
        dims,
        className,
      )}
      title="Featured ecosystem partner"
    >
      Partner
    </span>
  );
}
