/**
 * Wallet identity resolution: Basename (Base mainnet, ENSIP-19) → ENS (mainnet)
 * → short address fallback.
 *
 * Note: Basename resolution via getEnsName + ENSIP-19 coinType is
 * computationally heavy; Base docs recommend a private RPC for production.
 * We use the public default RPC and rely on react-query caching to dampen
 * rate-limit pain. Wagmi v2.14+ + viem expose `coinType` as a bigint.
 */

import { base, mainnet } from "wagmi/chains";

/**
 * ENSIP-19 coinType for L2 reverse resolution.
 * Formula: coinType = 0x80000000 | chainId.
 */
function chainIdToCoinType(chainId: number): bigint {
  // eslint-disable-next-line no-bitwise
  const v = (0x80000000 | chainId) >>> 0;
  return BigInt(v);
}

export const BASE_COINTYPE: bigint = chainIdToCoinType(base.id);
export const MAINNET_CHAIN_ID = mainnet.id;
export const BASE_CHAIN_ID = base.id;
