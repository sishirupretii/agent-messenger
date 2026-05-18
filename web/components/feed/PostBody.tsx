import { Fragment } from "react";
import Link from "next/link";

const MENTION_RE = /(@[a-z0-9_\-.]+(?:\.eth)?|@0x[a-fA-F0-9]{40})/gi;
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

/**
 * Render a feed post body with @mentions linked to the author's feed
 * profile and bare URLs linked. Mentions are case-preserving in display.
 */
export function PostBody({ text }: { text: string }) {
  if (!text) return null;
  // First split by URL, then split text runs by mention.
  const out: React.ReactNode[] = [];
  const urlParts = text.split(URL_RE);
  let key = 0;
  for (const part of urlParts) {
    if (URL_RE.test(part)) {
      URL_RE.lastIndex = 0;
      out.push(
        <a
          key={`u${key++}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent-2)]"
        >
          {part}
        </a>,
      );
      continue;
    }
    const subParts = part.split(MENTION_RE);
    for (const sub of subParts) {
      if (MENTION_RE.test(sub)) {
        MENTION_RE.lastIndex = 0;
        const handle = sub.slice(1);
        // All mention links go to /u/<handle> — the rich profile page
        // (holdings, agents launched, posts, DM button). The resolver
        // (/api/users/resolve) on that page handles 0x / basename / ens
        // uniformly, so we just pass the raw handle.
        const href = `/u/${encodeURIComponent(handle.toLowerCase())}`;
        out.push(
          <Link
            key={`m${key++}`}
            href={href}
            className="text-[var(--accent)] hover:text-[var(--accent-2)] font-medium"
          >
            {sub}
          </Link>,
        );
      } else if (sub) {
        out.push(<Fragment key={`t${key++}`}>{sub}</Fragment>);
      }
    }
  }
  return <div className="whitespace-pre-wrap break-words">{out}</div>;
}
