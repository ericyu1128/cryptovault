import type { ChainId, NetworkMode } from '@/lib/chains/types';
import type { SwapAsset, SwapProvider, SwapProviderId } from './types';

export * from './types';
export * from './fees';

/** Providers are code-split: neither SDK path loads until a swap is attempted. */
const loaders: Record<SwapProviderId, () => Promise<SwapProvider>> = {
  '0x': async () => (await import('./zeroex')).zeroExProvider,
  jupiter: async () => (await import('./jupiter')).jupiterProvider,
};

const cache = new Map<SwapProviderId, Promise<SwapProvider>>();

export function getSwapProvider(id: SwapProviderId): Promise<SwapProvider> {
  let p = cache.get(id);
  if (!p) {
    p = loaders[id]();
    cache.set(id, p);
  }
  return p;
}

/** Which provider, if any, can trade on this chain and network. */
export function providerIdFor(chain: ChainId, mode: NetworkMode): SwapProviderId | null {
  if (chain === 'ethereum' || chain === 'bsc') return mode === 'mainnet' ? '0x' : null;
  if (chain === 'solana') return mode === 'mainnet' ? 'jupiter' : null;
  return null;
}

export async function providerFor(chain: ChainId, mode: NetworkMode): Promise<SwapProvider | null> {
  const id = providerIdFor(chain, mode);
  return id ? getSwapProvider(id) : null;
}

/** Chains that can swap at all, used to build the chain picker. */
export const SWAPPABLE_CHAINS: ChainId[] = ['ethereum', 'bsc', 'solana'];

export async function assetsFor(chain: ChainId, mode: NetworkMode): Promise<SwapAsset[]> {
  const provider = await providerFor(chain, mode);
  return provider ? provider.listAssets(chain, mode) : [];
}
