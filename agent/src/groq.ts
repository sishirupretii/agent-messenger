import Groq from "groq-sdk";
import type { ToolBundle } from "./tools.js";

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  throw new Error("Missing GROQ_API_KEY env var");
}

const client = new Groq({ apiKey });
const model = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
const agentName = process.env.AGENT_NAME ?? "Agent";

const SYSTEM_PROMPT_BASE =
  process.env.AGENT_SYSTEM_PROMPT ??
  `You are ${agentName}, a friendly conversational agent who chats casually like a human friend. Keep replies short (1-3 sentences). Don't sound robotic. You may use light markdown for emphasis (**bold**, *italic*, \`code\`) — but only when it actually helps, not gratuitously.`;

const SYSTEM_PROMPT_TOOLS = `

You have tools available — use them when the user asks something they're for:
- Read the user's own Base mainnet balance / nonce / account type
- Look up any Base mainnet address's balance
- Look up any Base mainnet transaction by hash
- Get current Base mainnet network status (block, gas)
- Reverse-lookup an address to its ENS name (via Ethereum mainnet)
- Forward-resolve an ENS name (e.g. vitalik.eth) to its address
- Get the current UTC time
- Read-only gitlawb queries (list repos, get repo info, list PRs) — these require the agent runtime to have GITLAWB_DID + GITLAWB_KEY env vars and the gl CLI installed; if a gitlawb tool returns a "setup required" or "not_wired" error, relay that to the user honestly — do NOT fabricate repo data.

After calling a tool, weave the data into a natural sentence — never dump raw JSON or hex numbers without context. Round long decimals. Don't proactively call tools the user didn't ask for.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function generateReply(
  history: ChatTurn[],
  toolBundle?: ToolBundle,
): Promise<string> {
  const systemPrompt = toolBundle
    ? SYSTEM_PROMPT_BASE + SYSTEM_PROMPT_TOOLS
    : SYSTEM_PROMPT_BASE;

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  const MAX_ITER = 4;
  for (let i = 0; i < MAX_ITER; i++) {
    const completion = await client.chat.completions.create({
      model,
      messages,
      tools: toolBundle?.tools,
      tool_choice: toolBundle ? "auto" : undefined,
      temperature: 0.8,
      max_tokens: 500,
    });

    const choice = completion.choices[0];
    if (!choice) return "...";
    const msg = choice.message;

    if (msg.tool_calls && msg.tool_calls.length > 0 && toolBundle) {
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: msg.tool_calls,
      });
      for (const call of msg.tool_calls) {
        const impl = toolBundle.impls[call.function.name];
        let result: string;
        try {
          const args = call.function.arguments
            ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
            : {};
          result = impl
            ? await impl(args)
            : JSON.stringify({ error: `unknown tool: ${call.function.name}` });
        } catch (e) {
          result = JSON.stringify({
            error: e instanceof Error ? e.message : String(e),
          });
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
      continue;
    }

    const text = msg.content?.trim();
    return text && text.length > 0 ? text : "...";
  }

  return "(reached max tool iterations)";
}
