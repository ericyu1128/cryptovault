export type ChainId = 'bitcoin' | 'ethereum' | 'bsc' | 'solana' | 'xrp' | 'ton' | 'monero';

/** Chains that run the EVM and therefore share one adapter implementation. */
export type EvmChainId = Extract<ChainId, 'ethereum' | 'bsc'>;

export const EVM_CHAIN_IDS: EvmChainId[] = ['ethereum', 'bsc'];

export function isEvmChain(chain: ChainId): chain is EvmChainId {
  return chain === 'ethereum' || chain === 'bsc';
}
export type NetworkMode = 'mainnet' | 'testnet';

/** Bitcoin can present two different receive addresses from the same key. */
export type BtcAddressType = 'segwit' | 'taproot';

export interface ChainMeta {
  id: ChainId;
  name: string;
  symbol: string;
  decimals: number;
  /** Tailwind-friendly accent, used for the chain chip + charts. */
  accent: string;
  coingeckoId: string;
  testnetLabel: string;
  mainnetLabel: string;
  /** Human-readable note surfaced in the UI (reserves, rent, etc). */
  note?: string;
}

export interface DerivedAccount {
  chain: ChainId;
  address: string;
  /** Hex, no 0x prefix. Public material only - safe to render. */
  publicKey: string;
  derivationPath: string;
  /** Bitcoin only: the alternate address type from the same account. */
  altAddress?: { type: BtcAddressType; address: string; derivationPath: string };
}

export interface ChainBalance {
  chain: ChainId;
  /** Smallest indivisible unit (sats, wei, lamports, drops, nanotons). */
  raw: bigint;
  decimals: number;
  symbol: string;
  /** Amount that cannot be spent (XRPL reserve, Solana rent-exempt minimum). */
  reservedRaw?: bigint;
  /** True when the account has never been funded / does not exist on chain. */
  unfunded?: boolean;
}

export interface TokenBalance {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  raw: bigint;
}

/**
 * Known-token quirks that change how we must talk to a contract.
 *
 * `no-bool-return`  - USDT on Ethereum declares `transfer`/`approve` as
 *                     returning nothing instead of `bool`. Decoding a return
 *                     value from it throws, so those calls must not be decoded.
 * `zero-before-approve` - the contract reverts when changing a non-zero
 *                     allowance to another non-zero value; it must be set to 0
 *                     first. Again USDT, and the reason a lot of swap UIs fail
 *                     on exactly one token.
 */
export type TokenQuirk = 'no-bool-return' | 'zero-before-approve';

/**
 * A fungible asset that is not the chain's native coin: an ERC-20 on an EVM
 * chain, or an SPL mint on Solana.
 */
export interface TokenAsset {
  /** Stable identifier across networks, e.g. 'usdc'. */
  key: string;
  chain: ChainId;
  mode: NetworkMode;
  symbol: string;
  name: string;
  /** EVM contract address (0x…) or Solana mint (base58). */
  address: string;
  /**
   * Advisory only. Never use this for a write - `resolveDecimals()` reads the
   * real value from chain first, because a wrong decimals silently misprices a
   * transfer by orders of magnitude (BSC stablecoins are 18, not 6).
   */
  decimals: number;
  coingeckoId?: string;
  /** A bridged/wrapped representation rather than an issuer-native token. */
  bridged?: boolean;
  quirks?: TokenQuirk[];
}

export interface FeeQuote {
  /** Smallest unit, total expected network cost. */
  raw: bigint;
  decimals: number;
  symbol: string;
  label: string;
  /** e.g. "12 sat/vB" */
  detail?: string;
}

export interface SendParams {
  seed: Uint8Array;
  mode: NetworkMode;
  accountIndex: number;
  to: string;
  /** Decimal string in whole units, e.g. "0.015". */
  amount: string;
  /** XRPL destination tag / TON comment / EVM data. Chain-dependent. */
  memo?: string;
  /** EVM only: ERC-20 contract to transfer instead of the native coin. */
  tokenAddress?: string;
  /** Bitcoin only. */
  btcAddressType?: BtcAddressType;
  feeRate?: number;
}

export interface SendResult {
  hash: string;
  explorerUrl: string;
}

export interface DeriveOptions {
  accountIndex: number;
  mode: NetworkMode;
  btcAddressType?: BtcAddressType;
}

export interface ChainAdapter {
  meta: ChainMeta;
  derive(seed: Uint8Array, opts: DeriveOptions): Promise<DerivedAccount>;
  getBalance(address: string, mode: NetworkMode): Promise<ChainBalance>;
  estimateFee(params: Omit<SendParams, 'seed'> & { from?: string }): Promise<FeeQuote>;
  send(params: SendParams): Promise<SendResult>;
  validateAddress(address: string, mode: NetworkMode): boolean;
  explorerAddress(address: string, mode: NetworkMode): string;
  explorerTx(hash: string, mode: NetworkMode): string;
}
