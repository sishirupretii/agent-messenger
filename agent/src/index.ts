import "dotenv/config";
import { getTestUrl } from "@xmtp/agent-sdk";
import { createAgent } from "./xmtp.js";
import { generateReply, type ChatTurn } from "./groq.js";

const MAX_HISTORY_TURNS = 12;

async function main() {
  const agent = await createAgent();

  agent.on("start", async (ctx) => {
    console.log("==============================================");
    console.log(`Agent address:  ${agent.address ?? "(unknown)"}`);
    console.log(`Inbox ID:       ${ctx.client.inboxId}`);
    console.log(`XMTP env:       ${process.env.XMTP_ENV ?? "dev"}`);
    console.log(
      `Model:          ${process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile"}`,
    );
    console.log(`Personality:    ${process.env.AGENT_NAME ?? "Agent"}`);
    console.log(`Test URL:       ${getTestUrl(ctx.client)}`);
    console.log("Agent online. Listening for messages…");
    console.log("==============================================");

    const greetTarget = process.env.STARTUP_GREET_ADDRESS;
    const greetMessage = process.env.STARTUP_GREET_MESSAGE ?? "hey, you up?";
    if (greetTarget) {
      setTimeout(async () => {
        try {
          const dm = await agent.createDmWithAddress(
            greetTarget as `0x${string}`,
          );
          await dm.sendText(greetMessage);
          console.log(`[greet] Sent to ${greetTarget}: "${greetMessage}"`);
        } catch (e) {
          console.error("[greet] failed:", e);
        }
      }, 8000);
    }
  });

  agent.on("text", async (ctx) => {
    try {
      if (ctx.message.senderInboxId === ctx.client.inboxId) return;

      const incoming = ctx.message.content;
      if (!incoming || !incoming.trim()) return;

      // Pull recent messages from the conversation as Groq context.
      // This means agent memory persists naturally via XMTP's local DB
      // (and survives restarts when a Railway volume is mounted).
      const recent = await ctx.conversation.messages({
        limit: MAX_HISTORY_TURNS * 2,
      });

      const history: ChatTurn[] = recent
        .filter((m) => typeof m.content === "string" && (m.content as string).trim())
        .map((m) => ({
          role:
            m.senderInboxId === ctx.client.inboxId
              ? ("assistant" as const)
              : ("user" as const),
          content: m.content as string,
        }));

      const reply = await generateReply(history);
      await ctx.conversation.sendText(reply);

      const short = (s: string) => s.replace(/\s+/g, " ").slice(0, 80);
      console.log(
        `[${ctx.message.conversationId.slice(0, 8)}] in: "${short(incoming)}" | out: "${short(reply)}"`,
      );
    } catch (e) {
      console.error("Failed to handle text message:", e);
      try {
        await ctx.conversation.sendText("sorry, hit an error on that one.");
      } catch {}
    }
  });

  agent.on("unhandledError", (err) => {
    console.error("Agent unhandled error:", err);
  });

  await agent.start();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
