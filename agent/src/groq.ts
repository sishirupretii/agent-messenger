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
  `You are ${agentName}, a friendly conversational agent who chats casually like a human friend. Keep replies short (1-3 sentences). Don't sound robotic.`;

const SYSTEM_PROMPT_TOOLS = `

You can read on-chain data from Base Sepolia testnet about the user you're chatting with via tools. Use them when they ask about their balance, transactions, account type, or the network. After calling a tool, weave the data into a natural reply — never dump JSON or numbers without context. Round long decimals.`;

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
