/**
 * Room digest summarizer (v0.68).
 *
 * Given a window of wallet-signed messages from a SIGNA room, return a
 * short Groq-generated digest. Pure helper — no DB writes, no
 * signing. The caller composes the final wallet-signed post.
 *
 * Falls back to a deterministic template if GROQ_API_KEY is unset so
 * the digest endpoint stays useful in dev / self-hosted SIGNA nodes
 * without an LLM provider configured.
 */
import Groq from "groq-sdk";

const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

export type DigestMessage = {
  from_address: string;
  body: string;
  ts: number;
};

export type DigestResult = {
  text: string;
  generator: "groq" | "fallback";
  model: string | null;
  window_ms: { start: number; end: number };
  message_count: number;
  unique_signers: number;
};

const DIGEST_PREFIX = "📋 daily digest · ";

export function isDigest(body: string): boolean {
  return body.startsWith(DIGEST_PREFIX);
}

export function digestPrefix(): string {
  return DIGEST_PREFIX;
}

export async function summarizeRoom(args: {
  slug: string;
  description?: string | null;
  messages: DigestMessage[];
  windowStart: number;
  windowEnd: number;
}): Promise<DigestResult> {
  const messageCount = args.messages.length;
  const uniqueSigners = new Set(
    args.messages.map((m) => m.from_address.toLowerCase()),
  ).size;

  const baseShape = {
    text: "",
    window_ms: { start: args.windowStart, end: args.windowEnd },
    message_count: messageCount,
    unique_signers: uniqueSigners,
  };

  if (messageCount === 0) {
    return {
      ...baseShape,
      text: `${DIGEST_PREFIX}#${args.slug} — quiet day. 0 signed messages in the window.`,
      generator: "fallback",
      model: null,
    };
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return {
      ...baseShape,
      text: fallbackDigest(args.slug, args.messages, uniqueSigners),
      generator: "fallback",
      model: null,
    };
  }

  try {
    const client = new Groq({ apiKey: key });
    // Trim each message body so a chatty room doesn't blow the context.
    const lines = args.messages
      .slice(-100)
      .map(
        (m) =>
          `[${new Date(m.ts).toISOString().slice(11, 16)}] ${m.from_address.slice(0, 10)}…${m.from_address.slice(-4)}: ${m.body.slice(0, 280)}`,
      )
      .join("\n");

    const system =
      "You write 24-hour digests of wallet-signed chat rooms. Tone: terse, factual, no hype, no emoji storms, no exclamation marks. " +
      "Output exactly 3 short lines (each under 110 chars): " +
      "line 1 — headline with message count + unique signer count. " +
      "line 2 — the single most notable theme or topic. " +
      "line 3 — one specific quote or action that captures the room's last 24h, attributed by short address. " +
      "Do not invent participants or content. Only use the messages provided. " +
      "Do not add a trailing summary paragraph. Exactly 3 lines.";

    const user =
      `Room: #${args.slug}\n` +
      (args.description ? `About: ${args.description}\n` : "") +
      `Window: ${new Date(args.windowStart).toISOString()} → ${new Date(args.windowEnd).toISOString()}\n` +
      `Messages (${messageCount} from ${uniqueSigners} signers):\n${lines}`;

    const res = await client.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_completion_tokens: 220,
    });
    const text = res.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return {
        ...baseShape,
        text: fallbackDigest(args.slug, args.messages, uniqueSigners),
        generator: "fallback",
        model: null,
      };
    }
    return {
      ...baseShape,
      text: `${DIGEST_PREFIX}${text}`,
      generator: "groq",
      model: GROQ_MODEL,
    };
  } catch (e) {
    console.error(
      "[room-digest] groq failed:",
      e instanceof Error ? e.message : e,
    );
    return {
      ...baseShape,
      text: fallbackDigest(args.slug, args.messages, uniqueSigners),
      generator: "fallback",
      model: null,
    };
  }
}

function fallbackDigest(
  slug: string,
  messages: DigestMessage[],
  uniqueSigners: number,
): string {
  const sample = messages[Math.floor(messages.length / 2)] ?? messages[0];
  const sampleBody = sample.body.replace(/\s+/g, " ").slice(0, 80);
  const sampleFrom = `${sample.from_address.slice(0, 6)}…${sample.from_address.slice(-4)}`;
  return [
    `${DIGEST_PREFIX}#${slug} — ${messages.length} signed messages from ${uniqueSigners} wallets in the last 24h.`,
    `most recent activity: ${new Date(messages[messages.length - 1].ts).toISOString().slice(0, 16)} UTC.`,
    `sample: ${sampleFrom}: ${sampleBody}${sample.body.length > 80 ? "…" : ""}`,
  ].join("\n");
}
