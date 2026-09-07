import { EVM_CHAINS, SOLANA, TON, XRPL } from './networks';
import type { ChainId, ChainMeta } from './types';

/**
 * Chain metadata lives here - deliberately free of any SDK import - so the UI
 * can render the chain list, colours and symbols without pulling ethers,
 * @solana/web3.js, xrpl and @ton/ton into the first paint.
 */

export const BITCOIN_META: ChainMeta = {
  id: 'bitcoin',
  name: 'Bitcoin',
  symbol: 'BTC',
  decimals: 8,
  accent: '#f7931a',
  coingeckoId: 'bitcoin',
  mainnetLabel: 'Bitcoin Mainnet',
  testnetLabel: 'Testnet4',
  note: 'UTXO chain. Change is returned to your own address automatically.',
};

export const EVM_META: ChainMeta = {
  id: 'ethereum',
  name: 'Ethereum',
  symbol: 'ETH',
  decimals: 18,
  accent: '#627eea',
  coingeckoId: 'ethereum',
  mainnetLabel: EVM_CHAINS.ethereum.mainnet.name,
  testnetLabel: EVM_CHAINS.ethereum.testnet.name,
  note: 'Also holds any ERC-20 you deploy from the Token Deployer tab.',
};

export const BSC_META: ChainMeta = {
  id: 'bsc',
  name: 'BNB Smart Chain',
  symbol: 'BNB',
  decimals: 18,
  accent: '#f0b90b',
  coingeckoId: 'binancecoin',
  mainnetLabel: EVM_CHAINS.bsc.mainnet.name,
  testnetLabel: EVM_CHAINS.bsc.testnet.name,
  note: 'Same address and key as your Ethereum account - BSC is EVM-compatible.',
};

/**
 * Monero is registered but deliberately not in CHAIN_ORDER: the adapter is a
 * stub. XMR shares no cryptography with the other five chains (CryptoNote
 * keys, no account balances - a wallet must scan the chain with its view key),
 * so it cannot reuse any existing code path. See src/lib/chains/monero.ts.
 */
export const MONERO_META: ChainMeta = {
  id: 'monero',
  name: 'Monero',
  symbol: 'XMR',
  decimals: 12,
  accent: '#ff6600',
  coingeckoId: 'monero',
  mainnetLabel: 'Monero Mainnet',
  testnetLabel: 'Stagenet',
  note: 'Not implemented - requires CryptoNote key derivation and view-key chain scanning.',
};

export const SOLANA_META: ChainMeta = {
  id: 'solana',
  name: 'Solana',
  symbol: 'SOL',
  decimals: 9,
  accent: '#14f195',
  coingeckoId: 'solana',
  mainnetLabel: SOLANA.mainnet.label,
  testnetLabel: SOLANA.testnet.label,
  note: 'A system account must keep ~0.00089 SOL to stay rent-exempt.',
};

export const XRP_META: ChainMeta = {
  id: 'xrp',
  name: 'XRP Ledger',
  symbol: 'XRP',
  decimals: 6,
  accent: '#23b3d8',
  coingeckoId: 'ripple',
  mainnetLabel: XRPL.mainnet.label,
  testnetLabel: XRPL.testnet.label,
  note: 'Accounts must hold the base reserve; the account only exists once funded.',
};

export const TON_META: ChainMeta = {
  id: 'ton',
  name: 'TON',
  symbol: 'TON',
  decimals: 9,
  accent: '#0098ea',
  coingeckoId: 'the-open-network',
  mainnetLabel: TON.mainnet.label,
  testnetLabel: TON.testnet.label,
  note: 'Wallet V4 R2. The contract deploys itself with your first outgoing transfer.',
};

export const CHAIN_METAS: Record<ChainId, ChainMeta> = {
  bitcoin: BITCOIN_META,
  ethereum: EVM_META,
  bsc: BSC_META,
  solana: SOLANA_META,
  xrp: XRP_META,
  ton: TON_META,
  monero: MONERO_META,
};

/** Chains the dashboard renders. Monero is excluded until its adapter is real. */
export const CHAIN_ORDER: ChainId[] = ['bitcoin', 'ethereum', 'bsc', 'solana', 'xrp', 'ton'];

/** Registered but not yet usable - surfaced in Settings, never in the portfolio. */
export const PLANNED_CHAINS: ChainId[] = ['monero'];
