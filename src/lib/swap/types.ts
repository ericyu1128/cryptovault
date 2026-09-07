import type { ChainId, NetworkMode } from '@/lib/chains/types';

export type SwapProviderId = '0x' | 'jupiter';

/** A tradeable asset: an ERC-20/SPL mint, or the chain's native coin. */
export interface SwapAsset {
  chain: ChainId;
  mode: NetworkMode;
  /** Contract address, SPL mint, or the native sentinel for this provider. */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  native: boolean;
  bridged?: boolean;
}

export interface SwapFeeBreakdown {
  bps: number;
  /** Fee amount in the smallest unit of `asset`. */
  raw: bigint;
  asset: SwapAsset;
  recipient: string;
  /**
   * False when the fee could not be attached to this route - the swap still
   * executes, just without a fee. Never fail a user's trade to collect one.
   */
  applied: boolean;
  reason?: string;
}

export interface SwapQuote {
  provider: SwapProviderId;
  sell: SwapAsset;
  buy: SwapAsset;
  sellRaw: bigint;
  /** Expected output before slippage. */
  buyRaw: bigint;
  /** Guaranteed minimum output after slippage tolerance. */
  minBuyRaw: bigint;
  fee: SwapFeeBreakdown;
  gasRaw?: bigint;
  priceImpactPct?: number;
  route?: string[];
  slippageBps: number;
  /** Provider-specific payload required to build the transaction. */
  raw: unknown;
  fetchedAt: number;
}

export interface SwapQuoteRequest {
  chain: ChainId;
  mode: NetworkMode;
  sell: SwapAsset;
  buy: SwapAsset;
  /** Amount to sell, in the smallest unit. */
  sellRaw: bigint;
  slippageBps: number;
  /** Wallet address the swap will execute from. */
  taker: string;
}

export interface SwapExecuteRequest {
  quote: SwapQuote;
  seed: Uint8Array;
  accountIndex: number;
  onProgress?: (stage: SwapStage, detail?: string) => void;
}

export type SwapStage =
  | 'checking-allowance'
  | 'resetting-allowance'
  | 'approving'
  | 'building'
  | 'signing'
  | 'broadcasting'
  | 'confirming';

export interface SwapResult {
  hash: string;
  explorerUrl: string;
  approvalHashes?: string[];
}

export interface SwapProvider {
  id: SwapProviderId;
  label: string;
  supports(chain: ChainId, mode: NetworkMode): boolean;
  listAssets(chain: ChainId, mode: NetworkMode): SwapAsset[];
  quote(request: SwapQuoteRequest): Promise<SwapQuote>;
  execute(request: SwapExecuteRequest): Promise<SwapResult>;
}

/**
 * Thrown when a provider is reachable but declines to quote.
 *
 * Fields are declared explicitly rather than as constructor parameter
 * properties: Node's built-in type stripping (used by the test runner) rejects
 * that syntax, and it costs nothing to stay compatible with it.
 */
export class SwapQuoteError extends Error {
  readonly provider: SwapProviderId;
  readonly retryable: boolean;

  constructor(message: string, provider: SwapProviderId, retryable = false) {
    super(message);
    this.name = 'SwapQuoteError';
    this.provider = provider;
    this.retryable = retryable;
  }
}
