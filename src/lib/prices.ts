import { CHAIN_METAS, CHAIN_ORDER } from './chains/meta';
import type { ChainId } from './chains/types';

const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price';
const TTL_MS = 60_000;

export type PriceMap = Partial<Record<ChainId, number>>;

let cached: { at: number; prices: PriceMap } | null = null;
let inflight: Promise<PriceMap> | null = null;

/**
 * USD marks for the portfolio header. Prices are cosmetic: a failed fetch shows
 * dashes rather than blocking the balances, and testnet coins are still priced
 * off their mainnet ticker (clearly labelled in the UI as "test value").
 */
export async function fetchPrices(): Promise<PriceMap> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.prices;
  if (inflight) return inflight;

  const ids = CHAIN_ORDER.map((c) => CHAIN_METAS[c].coingeckoId).join(',');

  inflight = (async () => {
    try {
      const res = await fetch(`${COINGECKO}?ids=${ids}&vs_currencies=usd`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      const json = (await res.json()) as Record<string, { usd?: number }>;

      const prices: PriceMap = {};
      for (const chain of CHAIN_ORDER) {
        const usd = json[CHAIN_METAS[chain].coingeckoId]?.usd;
        if (typeof usd === 'number') prices[chain] = usd;
      }
      cached = { at: Date.now(), prices };
      return prices;
    } catch {
      return cached?.prices ?? {};
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
