import type { ChainAdapter, ChainId } from './types';

export * from './types';
export * from './meta';
export * from './networks';
export * from './tokens';

/**
 * Adapters are code-split. The five chain SDKs together are several megabytes;
 * loading them on demand keeps the first paint of the dashboard fast and means
 * a user who only touches Ethereum never downloads the Bitcoin or TON stack.
 */
const loaders: Record<ChainId, () => Promise<ChainAdapter>> = {
  bitcoin: async () => (await import('./bitcoin')).bitcoinAdapter,
  ethereum: async () => (await import('./evm')).evmAdapter,
  // Same module as Ethereum: one implementation, two network tables.
  bsc: async () => (await import('./evm')).bscAdapter,
  solana: async () => (await import('./solana')).solanaAdapter,
  xrp: async () => (await import('./xrp')).xrpAdapter,
  ton: async () => (await import('./ton')).tonAdapter,
  monero: async () => (await import('./monero')).moneroAdapter,
};

const cache = new Map<ChainId, Promise<ChainAdapter>>();

export function getAdapter(id: ChainId): Promise<ChainAdapter> {
  let p = cache.get(id);
  if (!p) {
    p = loaders[id]();
    cache.set(id, p);
  }
  return p;
}

/** Only the chains the dashboard renders - excludes the Monero stub. */
export async function getAllAdapters(): Promise<ChainAdapter[]> {
  const { CHAIN_ORDER } = await import('./meta');
  return Promise.all(CHAIN_ORDER.map(getAdapter));
}
