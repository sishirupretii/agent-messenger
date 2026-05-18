export function shortAddress(address: string | null | undefined, head = 6, tail = 4): string {
  if (!address) return "";
  const a = address.startsWith("0x") ? address : `0x${address}`;
  if (a.length <= head + tail + 1) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function formatRelative(date: Date | number): string {
  const d = typeof date === "number" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "now";
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatTime(date: Date | number): string {
  const d = typeof date === "number" ? new Date(date) : date;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Convert XMTP `sentAtNs` (bigint nanoseconds) to a JS Date. */
export function nsToDate(ns: bigint | number): Date {
  const ms = typeof ns === "bigint" ? Number(ns / 1_000_000n) : Math.floor(ns / 1_000_000);
  return new Date(ms);
}
