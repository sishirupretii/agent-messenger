import type Groq from "groq-sdk";
import {
  addressForEns,
  ensNameFor,
  getCode,
  getEthBalance,
  getNetworkStatus,
  getNonce,
  getTransaction,
} from "./chain.js";

type ToolImpl = (args: Record<string, unknown>) => Promise<string>;

export type ToolBundle = {
  tools: Groq.Chat.ChatCompletionTool[];
  impls: Record<string, ToolImpl>;
};

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
          "Get the total transaction count (nonce) of the user you're chatting with on Base Sepolia. Indicates how active they've been.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_user_account_type",
        description:
          "Check whether the user's address is a smart contract or a regular EOA on Base Sepolia.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_network_status",
        description:
          "Get the current Base Sepolia network status: latest block number and gas price.",
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
    {
      type: "function",
      function: {
        name: "lookup_transaction",
        description:
          "Look up a transaction on Base Sepolia by hash. Returns from, to, value, status, block, gas used.",
        parameters: {
          type: "object",
          properties: {
            hash: {
              type: "string",
              description: "Transaction hash starting with 0x, 64 hex chars.",
            },
          },
          required: ["hash"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "ens_name_for_address",
        description:
          "Reverse-lookup an Ethereum address to its primary ENS name (queries Ethereum mainnet). Useful when the user mentions an address and you want to refer to it by name.",
        parameters: {
          type: "object",
          properties: {
            address: { type: "string", description: "0x address." },
          },
          required: ["address"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "address_for_ens_name",
        description:
          "Resolve an ENS name (e.g. vitalik.eth) to its Ethereum address (queries mainnet).",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "ENS name, e.g. vitalik.eth." },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_current_time",
        description:
          "Get the current UTC time (server-side). Useful when the user asks 'what time is it' or about relative dates.",
        parameters: { type: "object", properties: {}, required: [] },
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
    lookup_transaction: async (args) => {
      const hash = typeof args.hash === "string" ? args.hash.trim() : "";
      if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
        return JSON.stringify({ error: "Invalid transaction hash" });
      }
      try {
        return JSON.stringify(await getTransaction(hash as `0x${string}`));
      } catch (e) {
        return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
    },
    ens_name_for_address: async (args) => {
      const addr = typeof args.address === "string" ? args.address.trim() : "";
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        return JSON.stringify({ error: "Invalid address" });
      }
      try {
        return JSON.stringify(await ensNameFor(addr as `0x${string}`));
      } catch (e) {
        return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
    },
    address_for_ens_name: async (args) => {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) return JSON.stringify({ error: "Provide an ENS name" });
      try {
        return JSON.stringify(await addressForEns(name));
      } catch (e) {
        return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
    },
    get_current_time: async () => {
      const now = new Date();
      return JSON.stringify({
        iso: now.toISOString(),
        unix: Math.floor(now.getTime() / 1000),
        utc: now.toUTCString(),
      });
    },
  };

  return { tools, impls };
}
