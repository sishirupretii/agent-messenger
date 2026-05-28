/**
 * Mention parser (v0.73).
 *
 * Extracts @0x... addresses from a room message body. Case-insensitive
 * on the address, lowercased on output, deduped, capped at 10 mentions
 * per message so a single signed envelope can't fan out unbounded.
 *
 * Pattern: ASCII '@' followed by '0x' followed by exactly 40 hex chars,
 * bounded by a non-word character on either side so we don't pick up
 * 0xFF inside a longer token.
 */
const MENTION_REGEX = /(^|[^\w])@(0x[a-fA-F0-9]{40})(?=$|[^a-fA-F0-9])/g;
const MAX_MENTIONS_PER_MESSAGE = 10;

export function parseMentions(body: string): string[] {
  if (!body) return [];
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  // reset the regex's lastIndex on each call (it's a /g regex)
  MENTION_REGEX.lastIndex = 0;
  while ((m = MENTION_REGEX.exec(body)) !== null) {
    out.add(m[2].toLowerCase());
    if (out.size >= MAX_MENTIONS_PER_MESSAGE) break;
  }
  return Array.from(out);
}
