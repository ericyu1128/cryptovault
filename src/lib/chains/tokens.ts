import type { ChainId, NetworkMode, TokenAsset } from './types';

/**
 * Non-native asset registry.
 *
 * Every address below was verified against the issuer's own published source,
 * not a block explorer search or a token aggregator:
 *
 *   USDC  - Circle, developers.circle.com/stablecoins/usdc-contract-addresses
 *   USDT  - Tether, tether.to/en/supported-protocols
 *   BSC   - PancakeSwap default token list (Binance-Peg wrappers; neither
 *           Circle nor Tether issues natively on BNB Smart Chain)
 *
 * Two traps encoded here deliberately:
 *
 *  1. BSC stablecoins are 18 decimals, not the 6 they use on Ethereum and
 *     Solana. Assuming 6 misprices a transfer by a factor of 10^12.
 *  2. USDT on Ethereum has a non-standard ABI - see TokenQuirk.
 */

export const USDC_ETHEREUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
export const USDT_ETHEREUM = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
export const WETH_ETHEREUM = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

/** 0x and most aggregators use this sentinel for a chain's native coin. */
export const NATIVE_TOKEN_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const TOKENS: TokenAsset[] = [
  /* ------------------------------------------------ Ethereum mainnet */
  {
    key: 'usdc',
    chain: 'ethereum',
    mode: 'mainnet',
    symbol: 'USDC',
    name: 'USD Coin',
    address: USDC_ETHEREUM,
    decimals: 6,
    coingeckoId: 'usd-coin',
  },
  {
    key: 'usdt',
    chain: 'ethereum',
    mode: 'mainnet',
    symbol: 'USDT',
    name: 'Tether USD',
    address: USDT_ETHEREUM,
    decimals: 6,
    coingeckoId: 'tether',
    // Tether's own docs: "does not return a Boolean value in the transfer
    // function", and it reverts on a non-zero -> non-zero approve.
    quirks: ['no-bool-return', 'zero-before-approve'],
  },
  {
    key: 'weth',
    chain: 'ethereum',
    mode: 'mainnet',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    address: WETH_ETHEREUM,
    decimals: 18,
    coingeckoId: 'ethereum',
  },

  /* ------------------------------------------------- Sepolia testnet */
  {
    key: 'usdc',
    chain: 'ethereum',
    mode: 'testnet',
    symbol: 'USDC',
    name: 'USD Coin (Sepolia)',
    address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    decimals: 6,
    coingeckoId: 'usd-coin',
  },
  // Tether publishes no official Sepolia deployment, so none is listed here.
  // Inventing one would send test transfers into a stranger's contract.

  /* ----------------------------------------------------- BNB Smart Chain */
  {
    key: 'usdt',
    chain: 'bsc',
    mode: 'mainnet',
    symbol: 'USDT',
    name: 'Binance-Peg USDT',
    address: '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
    coingeckoId: 'tether',
    bridged: true,
  },
  {
    key: 'usdc',
    chain: 'bsc',
    mode: 'mainnet',
    symbol: 'USDC',
    name: 'Binance-Peg USD Coin',
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    decimals: 18,
    coingeckoId: 'usd-coin',
    bridged: true,
  },
  {
    key: 'wbnb',
    chain: 'bsc',
    mode: 'mainnet',
    symbol: 'WBNB',
    name: 'Wrapped BNB',
    address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    decimals: 18,
    coingeckoId: 'binancecoin',
  },
  // BSC testnet has no canonical issuer stablecoin; native tBNB only.

  /* --------------------------------------------------- Solana mainnet */
  {
    key: 'usdc',
    chain: 'solana',
    mode: 'mainnet',
    symbol: 'USDC',
    name: 'USD Coin',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    coingeckoId: 'usd-coin',
  },
  {
    key: 'usdt',
    chain: 'solana',
    mode: 'mainnet',
    symbol: 'USDT',
    name: 'Tether USD',
    address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
    coingeckoId: 'tether',
  },
  {
    key: 'wsol',
    chain: 'solana',
    mode: 'mainnet',
    symbol: 'wSOL',
    name: 'Wrapped SOL',
    address: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    coingeckoId: 'solana',
  },

  /* ---------------------------------------------------- Solana devnet */
  {
    key: 'usdc',
    chain: 'solana',
    mode: 'testnet',
    symbol: 'USDC',
    name: 'USD Coin (Devnet)',
    address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    decimals: 6,
    coingeckoId: 'usd-coin',
  },
  {
    key: 'wsol',
    chain: 'solana',
    mode: 'testnet',
    symbol: 'wSOL',
    name: 'Wrapped SOL',
    address: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    coingeckoId: 'solana',
  },
];

/** Every registry token for one chain on one network. */
export function tokensFor(chain: ChainId, mode: NetworkMode): TokenAsset[] {
  return TOKENS.filter((t) => t.chain === chain && t.mode === mode);
}

export function findToken(
  chain: ChainId,
  mode: NetworkMode,
  addressOrKey: string,
): TokenAsset | undefined {
  const needle = addressOrKey.toLowerCase();
  return TOKENS.find(
    (t) =>
      t.chain === chain &&
      t.mode === mode &&
      (t.address.toLowerCase() === needle || t.key === needle),
  );
}

export function tokenQuirks(chain: ChainId, mode: NetworkMode, address: string): Set<string> {
  return new Set(findToken(chain, mode, address)?.quirks ?? []);
}

/** True for the sentinel address aggregators use to mean "the native coin". */
export function isNativeSentinel(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN_SENTINEL.toLowerCase();
}

/** The wrapped-native contract for an EVM chain, used for fee-token selection. */
export function wrappedNativeFor(chain: ChainId, mode: NetworkMode): TokenAsset | undefined {
  return TOKENS.find(
    (t) => t.chain === chain && t.mode === mode && (t.key === 'weth' || t.key === 'wbnb'),
  );
}

export const ALL_TOKENS: readonly TokenAsset[] = TOKENS;
