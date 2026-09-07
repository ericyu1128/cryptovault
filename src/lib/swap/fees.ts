import type { ChainId, NetworkMode } from '@/lib/chains/types';
import { isNativeSentinel, wrappedNativeFor } from '@/lib/chains/tokens';
import type { SwapAsset } from './types';

/**
 * Developer fee configuration.
 *
 * The fee is disclosed to the user in the quote breakdown, the confirmation
 * dialog and the result toast. Please keep it that way: a wallet that quietly
 * skims a percentage of every trade is indistinguishable from malware to the
 * person whose money it is, and every mainstream aggregator (0x, Jupiter,
 * 1inch, Uniswap's own interface) shows the number up front.
 */

/** 0.5%. Basis points, so 50 / 10_000. */
export const DEV_FEE_BPS = 50;

/**
 * EVM fee destination. Fees on Ethereum and BNB Smart Chain are transferred
 * here by the aggregator as part of the swap transaction itself - no separate
 * transfer, no extra gas.
 */
export const EVM_FEE_RECIPIENT = '0x2c76D6c28e22f432Cf796a53B49C863d62A488C4';

/**
 * Solana fee destination (wallet owner).
 *
 * Jupiter pays fees into an *associated token account*, not a wallet, so the
 * ATA for each mint you want to earn in must exist on chain before it can be
 * used. Create them once with:
 *
 *     npm run setup:solana-fees
 *
 * Any mint whose ATA is missing simply trades at 0% instead of failing.
 */
export const SOLANA_FEE_OWNER = 'CryVfG5uS6HmKquiecp9VCvo9zRk9bshFsGEfVcUc2iE';

/** Basis-point math on bigints - no floats anywhere near a balance. */
export function applyBps(amountRaw: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error(`Invalid basis points: ${bps}`);
  }
  return (amountRaw * BigInt(bps)) / 10_000n;
}

/** Subtract a slippage tolerance from an expected output. */
export function applySlippage(amountRaw: bigint, slippageBps: number): bigint {
  return amountRaw - applyBps(amountRaw, slippageBps);
}

function isWrappedNative(asset: SwapAsset): boolean {
  const wrapped = wrappedNativeFor(asset.chain, asset.mode);
  return Boolean(wrapped && wrapped.address.toLowerCase() === asset.address.toLowerCase());
}

export function isNativeAsset(asset: SwapAsset): boolean {
  return asset.native || isNativeSentinel(asset.address);
}

/**
 * Which token the EVM fee is collected in.
 *
 * 0x requires the fee token to be one of the two sides of the trade, so a fee
 * cannot be denominated in an arbitrary asset. Preference order:
 *
 *   1. the buy side, if it is native ETH/BNB      -> fee arrives as ETH
 *   2. the buy side, if it is WETH/WBNB           -> fee arrives as WETH
 *   3. the sell side, if it is native or wrapped  -> fee arrives as ETH/WETH
 *   4. otherwise the buy side
 *
 * The returned array is a preference list: if the aggregator rejects the first
 * choice, the caller retries with the next before giving up on the fee.
 */
export function evmFeeTokenPreference(sell: SwapAsset, buy: SwapAsset): SwapAsset[] {
  const preferred: SwapAsset[] = [];
  const push = (a: SwapAsset) => {
    if (!preferred.some((p) => p.address.toLowerCase() === a.address.toLowerCase())) preferred.push(a);
  };

  if (isNativeAsset(buy)) push(buy);
  if (isWrappedNative(buy)) push(buy);
  if (isNativeAsset(sell)) push(sell);
  if (isWrappedNative(sell)) push(sell);
  push(buy);
  push(sell);

  return preferred;
}

export function feeRecipientFor(chain: ChainId): string | null {
  if (chain === 'ethereum' || chain === 'bsc') return EVM_FEE_RECIPIENT;
  if (chain === 'solana') return SOLANA_FEE_OWNER;
  return null;
}

/**
 * Human-readable statement of where a fee ends up, shown in the UI so the
 * behaviour is never a surprise.
 */
export function feeDisclosure(chain: ChainId, mode: NetworkMode): string {
  const pct = (DEV_FEE_BPS / 100).toFixed(2).replace(/\.?0+$/, '');
  if (chain === 'solana') {
    return `${pct}% of the amount received goes to the app's Solana fee account. ${
      mode === 'testnet' ? 'Devnet trades are not routed.' : ''
    }`.trim();
  }
  return `${pct}% of the amount received goes to the app developer, transferred by the aggregator inside the same transaction.`;
}
