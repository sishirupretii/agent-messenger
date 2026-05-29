"use client";

interface Props {
  symbol: string;
  rank: number;
  shv: number;
  signers7d: number;
  msgs7d: number;
  tokenAddress: string;
}

/**
 * Tweet-this-rank button with prefilled bullish copy. The deployer
 * (or any holder) clicks this and X opens with the shill ready to
 * post. The OG card on the destination URL does the rest of the
 * shilling — rank, SHV, signer count, all visible in the X preview.
 */
export function TokenWarsClient({
  symbol,
  rank,
  shv,
  signers7d,
  msgs7d,
  tokenAddress,
}: Props) {
  const url = `https://www.signaagent.xyz/token-wars/${tokenAddress}`;
  const lines = [
    rank === 1
      ? `$${symbol} is #1 on @signaagent token wars.`
      : rank <= 3
        ? `$${symbol} is top 3 on @signaagent token wars. rank #${rank}.`
        : rank <= 10
          ? `$${symbol} cracked the top 10 on @signaagent token wars at rank #${rank}.`
          : `$${symbol} sitting at rank #${rank} on @signaagent token wars.`,
    ``,
    `signed holder velocity: ${shv}`,
    `signers this week: ${signers7d}`,
    `signed messages this week: ${msgs7d}`,
    ``,
    `wallet signed chat on base. hold to chat enforced via balanceOf. climb the board.`,
  ].join("\n");
  const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(lines)}&url=${encodeURIComponent(url)}`;

  function copyLink() {
    navigator.clipboard
      .writeText(url)
      .then(() => alert("link copied"))
      .catch(() => window.prompt("copy this link:", url));
  }

  return (
    <>
      <a
        href={tweet}
        target="_blank"
        rel="noreferrer"
        className="border border-[var(--accent)]/40 hover:border-[var(--accent)] text-[var(--accent)] font-medium rounded-full px-5 py-2.5 text-[14px] transition-colors uppercase tracking-wide"
      >
        tweet rank #{rank} →
      </a>
      <button
        onClick={copyLink}
        className="border border-white/10 hover:border-white/30 text-white/55 hover:text-white font-medium rounded-full px-4 py-2.5 text-[12.5px] transition-colors"
      >
        copy link
      </button>
    </>
  );
}
