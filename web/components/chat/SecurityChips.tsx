import { Lock, BadgeCheck, Hexagon } from "lucide-react";

type Props = {
  verified?: boolean;
  online?: boolean | null;
};

/**
 * Tiny row of security/context chips under the peer name in a conversation
 * header. Restrained: 11px muted text, small icons, dot separators.
 */
export function SecurityChips({ verified, online }: Props) {
  return (
    <div className="flex items-center flex-wrap gap-x-1 text-[11px] text-white/45">
      <span className="inline-flex items-center gap-1">
        <Lock className="size-2.5" />
        End-to-end encrypted
      </span>
      {verified && (
        <>
          <Sep />
          <span className="inline-flex items-center gap-1 text-[var(--accent)]">
            <BadgeCheck className="size-2.5" />
            Verified
          </span>
        </>
      )}
      <Sep />
      <span className="inline-flex items-center gap-1">
        <Hexagon className="size-2.5" />
        Base
      </span>
      {online === true && (
        <>
          <Sep />
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-[var(--online)]" />
            Online
          </span>
        </>
      )}
    </div>
  );
}

function Sep() {
  return <span className="text-white/15">·</span>;
}
