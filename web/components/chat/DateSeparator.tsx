export function DateSeparator({ date }: { date: Date }) {
  const label = formatDateLabel(date);
  return (
    <div className="flex items-center gap-2 my-3 px-2">
      <div className="flex-1 h-px bg-white/[0.06]" />
      <span className="text-[10px] uppercase tracking-wider text-white/40 font-medium">
        {label}
      </span>
      <div className="flex-1 h-px bg-white/[0.06]" />
    </div>
  );
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatDateLabel(date: Date): string {
  const today = startOfDay(new Date());
  const yesterday = today - 24 * 60 * 60 * 1000;
  const target = startOfDay(date);
  if (target === today) return "Today";
  if (target === yesterday) return "Yesterday";
  const oneWeekAgo = today - 6 * 24 * 60 * 60 * 1000;
  if (target >= oneWeekAgo) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a) === startOfDay(b);
}
