import type Groq from "groq-sdk";
import { getCode, getEthBalance, getNetworkStatus, getNonce } from "./chain.js";

type ToolImpl = (args: Record<string, unknown>) => Promise<string>;

export type ToolBundle = {
  tools: Groq.Chat.ChatCompletionTool[];
  impls: Record<string, ToolImpl>;
};

/**
 * Build the set of tools the LLM can call on a per-conversation basis.
 * The peer's wallet address is bound in via closure so the LLM doesn't
 * need to know or pass it.
 */
export function buildToolsForPeer(peerAddress: `0x${string}` | null): ToolBundle {
  const tools: Groq.Chat.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "get_user_balance",
        description:
          "Get the ETH balance of the user you're chatting with, on Base Sepolia testnet. Returns wei and eth string. No arguments.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_user_tx_count",
        description:
          "Get the total transaction count (nonce) of the user you're chatting with on Base Sepolia. Indicates how active they've been. No arguments.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_user_account_type",
        description:
          "Check whether the user's address is a smart contract or a regular EOA on Base Sepolia. No arguments.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_network_status",
        description:
          "Get the current Base Sepolia network status: latest block number and gas price. No arguments.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_balance_of_address",
        description:
          "Get the ETH balance of any specific Base Sepolia address. Use when the user asks about an address other than their own.",
        parameters: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "An EVM address starting with 0x, 40 hex chars.",
            },
          },
          required: ["address"],
        },
      },
    },
  ];

  const impls: Record<string, ToolImpl> = {
    get_user_balance: async () => {
      if (!peerAddress)
        return JSON.stringify({ error: "Peer address unknown for this conversation." });
      try {
        const bal = await getEthBalance(peerAddress);
        return JSON.stringify({
          chain: "base-sepolia",
          address: peerAddress,
          ...bal,
        });
      } catch (e) {
        return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
    },
    get_user_tx_count: async () => {
      if (!peerAddress)
        return JSON.stringify({ error: "Peer address unknown for this conversation." });
      try {
        const n = await getNonce(peerAddress);
        return JSON.stringify({
          chain: "base-sepolia",
          address: peerAddress,
          count: n,
        });
      } catch (e) {
        return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
    },
    get_user_account_type: async () => {
      if (!peerAddress)
        return JSON.stringify({ error: "Peer address unknown for this conversation." });
      try {
        const info = await getCode(peerAddress);
        return JSON.stringify({
          chain: "base-sepolia",
          address: peerAddress,
          type: info.isContract ? "smart-contract" : "eoa",
          ...info,
        });
      } catch (e) {
        return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
    },
    get_network_status: async () => {
      try {
        return JSON.stringify(await getNetworkStatus());
      } catch (e) {
        return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
    },
    get_balance_of_address: async (args) => {
      const addr = typeof args.address === "string" ? args.address.trim() : "";
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        return JSON.stringify({ error: "Invalid address" });
      }
      try {
        const bal = await getEthBalance(addr as `0x${string}`);
        return JSON.stringify({
          chain: "base-sepolia",
          address: addr.toLowerCase(),
          ...bal,
        });
      } catch (e) {
        return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
    },
  };

  return { tools, impls };
}
