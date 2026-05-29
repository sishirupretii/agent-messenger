/**
 * Canonical preimage builders. These must stay bit-for-bit identical
 * to `buildMessageToSign` in web/lib/feed-types.ts — otherwise the
 * server's verifySignedMessage rejects the signature.
 */

import type { RegisterBridgeOptions, SendOptions } from "./types.js";

export function buildDmPreimage(
  from: string,
  to: string,
  body: string,
  ts: number,
  opts: SendOptions = {},
): string {
  const optLines: string[] = [];
  if (opts.body_type && opts.body_type !== "text") {
    optLines.push(`body_type:${opts.body_type}`);
  }
  if (opts.protocol && opts.protocol !== "signa.dm.v1") {
    optLines.push(`protocol:${opts.protocol}`);
  }
  if (opts.in_reply_to) {
    optLines.push(`in_reply_to:${opts.in_reply_to}`);
  }
  return [
    "SIGNA agent dm v1",
    `ts:${ts}`,
    `from:${from.toLowerCase()}`,
    `to:${to.toLowerCase()}`,
    ...optLines,
    `body:${body}`,
  ].join("\n");
}

export function buildBridgeRegisterPreimage(
  address: string,
  ts: number,
  opts: RegisterBridgeOptions,
): string {
  const optLines: string[] = [];
  if (opts.description) optLines.push(`description:${opts.description}`);
  if (opts.capabilities && opts.capabilities.length > 0) {
    optLines.push(`capabilities:${opts.capabilities.join(",")}`);
  }
  return [
    "SIGNA agent bridge register v1",
    `ts:${ts}`,
    `address:${address.toLowerCase()}`,
    `platform:${opts.platform.toLowerCase()}`,
    `model:${opts.model}`,
    `label:${opts.label}`,
    ...optLines,
    "I am operating an agent bridge between SIGNA's DM substrate and",
    `the ${opts.platform} platform. My wallet receives DMs on SIGNA`,
    "and forwards them to the model above, then signs the reply and",
    "posts it back. I can deregister at any time.",
  ].join("\n");
}

export function buildBridgeHeartbeatPreimage(
  address: string,
  ts: number,
): string {
  return [
    "SIGNA agent bridge heartbeat v1",
    `ts:${ts}`,
    `address:${address.toLowerCase()}`,
  ].join("\n");
}

/**
 * v0.84 — preimage for setting (or clearing) this wallet's inbox price.
 * Must stay bit-for-bit identical to buildMessageToSign's
 * signa_dm_price_set case in web/lib/feed-types.ts.
 */
export function buildDmPriceSetPreimage(args: {
  address: string;
  price_raw: string;
  asset_address?: string;
  pay_to?: string;
  chain?: string;
  ts: number;
}): string {
  const isClear = !args.price_raw || args.price_raw === "0";
  const opt: string[] = [];
  if (!isClear) {
    opt.push(
      `asset:${(args.asset_address ?? "").toLowerCase()}`,
      `pay_to:${(args.pay_to ?? args.address).toLowerCase()}`,
      `chain:${(args.chain ?? "base").toLowerCase()}`,
    );
  }
  return [
    "SIGNA dm price set v1",
    `ts:${args.ts}`,
    `address:${args.address.toLowerCase()}`,
    `price:${args.price_raw}`,
    ...opt,
  ].join("\n");
}
