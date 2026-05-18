import { createPublicClient, http, formatEther, formatGwei } from "viem";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL;

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl),
});

export async function getEthBalance(address: `0x${string}`) {
  const wei = await publicClient.getBalance({ address });
  return {
    wei: wei.toString(),
    eth: formatEther(wei),
  };
}

export async function getNonce(address: `0x${string}`) {
  return publicClient.getTransactionCount({ address });
}

export async function getNetworkStatus() {
  const [block, gas] = await Promise.all([
    publicClient.getBlockNumber(),
    publicClient.getGasPrice(),
  ]);
  return {
    chain: "base-sepolia",
    chainId: baseSepolia.id,
    blockNumber: block.toString(),
    gasPriceWei: gas.toString(),
    gasPriceGwei: formatGwei(gas),
  };
}

export async function getCode(address: `0x${string}`) {
  const code = await publicClient.getCode({ address });
  return {
    isContract: !!code && code !== "0x",
    bytecodeLength: code ? (code.length - 2) / 2 : 0,
  };
}
