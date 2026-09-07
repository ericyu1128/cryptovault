import type { EvmChainId, NetworkMode } from './types';

/**
 * All endpoints are public and keyless by default so the app runs with zero
 * configuration. Override any of them in .env.local when you hit rate limits.
 */
const env = (key: string): string | undefined => {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
};

export const ESPLORA = {
  mainnet: env('NEXT_PUBLIC_ESPLORA_MAINNET') ?? 'https://mempool.space/api',
  testnet: env('NEXT_PUBLIC_ESPLORA_TESTNET') ?? 'https://mempool.space/testnet4/api',
} as const;

export const BTC_EXPLORER = {
  mainnet: 'https://mempool.space',
  testnet: 'https://mempool.space/testnet4',
} as const;

export interface EvmNetwork {
  chainId: number;
  name: string;
  rpc: string;
  explorer: string;
  /** Ticker of the chain's native coin - ETH on Ethereum, BNB on BSC. */
  symbol: string;
  faucet?: string;
  /** Whether a DEX aggregator covers this network for swaps. */
  swapSupported: boolean;
}

/**
 * Every EVM network, keyed by the ChainId that owns it. Ethereum and BNB Smart
 * Chain share one adapter implementation - only this table differs.
 */
export const EVM_CHAINS: Record<EvmChainId, Record<NetworkMode, EvmNetwork>> = {
  ethereum: {
    mainnet: {
      chainId: 1,
      name: 'Ethereum Mainnet',
      rpc: env('NEXT_PUBLIC_RPC_ETHEREUM') ?? 'https://ethereum-rpc.publicnode.com',
      explorer: 'https://etherscan.io',
      symbol: 'ETH',
      swapSupported: true,
    },
    testnet: {
      chainId: 11155111,
      name: 'Sepolia',
      rpc: env('NEXT_PUBLIC_RPC_SEPOLIA') ?? 'https://ethereum-sepolia-rpc.publicnode.com',
      explorer: 'https://sepolia.etherscan.io',
      symbol: 'ETH',
      faucet: 'https://sepoliafaucet.com',
      // Aggregators route real liquidity only; there is none on a testnet.
      swapSupported: false,
    },
  },
  bsc: {
    mainnet: {
      chainId: 56,
      name: 'BNB Smart Chain',
      rpc: env('NEXT_PUBLIC_RPC_BSC') ?? 'https://bsc-rpc.publicnode.com',
      explorer: 'https://bscscan.com',
      symbol: 'BNB',
      swapSupported: true,
    },
    testnet: {
      chainId: 97,
      name: 'BSC Testnet',
      rpc: env('NEXT_PUBLIC_RPC_BSC_TESTNET') ?? 'https://bsc-testnet-rpc.publicnode.com',
      explorer: 'https://testnet.bscscan.com',
      symbol: 'tBNB',
      faucet: 'https://www.bnbchain.org/en/testnet-faucet',
      swapSupported: false,
    },
  },
};

/** Back-compat alias: the Ethereum networks, which the deployer targets. */
export const EVM = EVM_CHAINS.ethereum;

export const SOLANA = {
  mainnet: {
    rpc: env('NEXT_PUBLIC_RPC_SOLANA') ?? 'https://api.mainnet-beta.solana.com',
    explorerQuery: '',
    label: 'Mainnet Beta',
  },
  testnet: {
    rpc: env('NEXT_PUBLIC_RPC_SOLANA_DEVNET') ?? 'https://api.devnet.solana.com',
    explorerQuery: '?cluster=devnet',
    label: 'Devnet',
    faucet: 'https://faucet.solana.com',
  },
} as const;

export const XRPL = {
  mainnet: {
    rpc: env('NEXT_PUBLIC_RPC_XRPL') ?? 'https://xrplcluster.com',
    explorer: 'https://livenet.xrpl.org',
    label: 'XRPL Mainnet',
  },
  testnet: {
    rpc: env('NEXT_PUBLIC_RPC_XRPL_TESTNET') ?? 'https://s.altnet.rippletest.net:51234',
    explorer: 'https://testnet.xrpl.org',
    label: 'XRPL Testnet',
    faucet: 'https://xrpl.org/xrp-testnet-faucet.html',
  },
} as const;

export const TON = {
  mainnet: {
    rpc: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: env('NEXT_PUBLIC_TONCENTER_KEY'),
    explorer: 'https://tonviewer.com',
    label: 'TON Mainnet',
  },
  testnet: {
    rpc: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    apiKey: env('NEXT_PUBLIC_TONCENTER_TESTNET_KEY'),
    explorer: 'https://testnet.tonviewer.com',
    label: 'TON Testnet',
    faucet: 'https://t.me/testgiver_ton_bot',
  },
} as const;

/** Faucet links surfaced on the Portfolio tab when running on testnet. */
export const FAUCETS: Record<string, string> = {
  bitcoin: 'https://coinfaucet.eu/en/btc-testnet4/',
  ethereum: 'https://sepoliafaucet.com',
  bsc: 'https://www.bnbchain.org/en/testnet-faucet',
  solana: 'https://faucet.solana.com',
  xrp: 'https://xrpl.org/xrp-testnet-faucet.html',
  ton: 'https://t.me/testgiver_ton_bot',
};
