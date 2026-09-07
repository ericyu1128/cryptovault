import '@/lib/polyfills';

import { getConnection, solanaKeypair } from '@/lib/chains/solana';
import { SOLANA } from '@/lib/chains/networks';
import { tokensFor } from '@/lib/chains/tokens';
import type { ChainId, NetworkMode } from '@/lib/chains/types';
import { DEV_FEE_BPS, SOLANA_FEE_OWNER } from './fees';
import {
  SwapQuoteError,
  type SwapAsset,
  type SwapExecuteRequest,
  type SwapProvider,
  type SwapQuote,
  type SwapQuoteRequest,
  type SwapResult,
} from './types';

/** Jupiter's canonical wrapped-SOL mint; native SOL trades through it. */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * lite-api is the keyless tier (rate limited); api.jup.ag needs an API key.
 * We pick automatically based on whether a key is configured.
 */
function endpoints(): { base: string; headers: Record<string, string> } {
  const key = process.env.NEXT_PUBLIC_JUPITER_API_KEY;
  return key
    ? { base: 'https://api.jup.ag/swap/v1', headers: { 'x-api-key': key } }
    : { base: 'https://lite-api.jup.ag/swap/v1', headers: {} };
}

interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee?: { amount: string; feeBps: number } | null;
  priceImpactPct?: string;
  routePlan?: Array<{ swapInfo?: { label?: string } }>;
}

interface JupiterRaw {
  quoteResponse: JupiterQuoteResponse;
  mode: NetworkMode;
  feeAccount: string | null;
}

/**
 * Jupiter pays platform fees into an associated token account, not a wallet.
 * Derive the ATA for the token we want to earn in and confirm it exists - a
 * missing account makes the whole swap fail, so we drop the fee instead.
 */
async function resolveFeeAccount(
  outputMint: string,
  mode: NetworkMode,
): Promise<{ account: string | null; reason?: string }> {
  try {
    const { PublicKey } = await import('@solana/web3.js');
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');

    const owner = new PublicKey(SOLANA_FEE_OWNER);
    const ata = getAssociatedTokenAddressSync(new PublicKey(outputMint), owner, true);

    const info = await getConnection(mode).getAccountInfo(ata);
    if (!info) {
      return {
        account: null,
        reason: `No fee token account exists for this mint. Run "npm run setup:solana-fees" to create it; the trade runs at 0% until then.`,
      };
    }
    return { account: ata.toBase58() };
  } catch (err) {
    return { account: null, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function jupiterAssets(chain: ChainId, mode: NetworkMode): SwapAsset[] {
  if (chain !== 'solana') return [];

  const native: SwapAsset = {
    chain,
    mode,
    address: WSOL_MINT,
    symbol: 'SOL',
    name: 'Solana',
    decimals: 9,
    native: true,
  };

  const tokens = tokensFor('solana', mode)
    .filter((t) => t.address !== WSOL_MINT)
    .map<SwapAsset>((t) => ({
      chain,
      mode,
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      native: false,
      bridged: t.bridged,
    }));

  return [native, ...tokens];
}

export const jupiterProvider: SwapProvider = {
  id: 'jupiter',
  label: 'Jupiter',

  // Jupiter routes mainnet liquidity only - there is nothing to trade on devnet.
  supports: (chain, mode) => chain === 'solana' && mode === 'mainnet',

  listAssets: jupiterAssets,

  async quote({ mode, sell, buy, sellRaw, slippageBps }: SwapQuoteRequest): Promise<SwapQuote> {
    const { base, headers } = endpoints();
    const fee = await resolveFeeAccount(buy.address, mode);

    const params = new URLSearchParams({
      inputMint: sell.address,
      outputMint: buy.address,
      amount: sellRaw.toString(),
      slippageBps: String(slippageBps),
    });
    if (fee.account) params.set('platformFeeBps', String(DEV_FEE_BPS));

    const res = await fetch(`${base}/quote?${params.toString()}`, { headers, cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SwapQuoteError(`Jupiter quote failed (${res.status}): ${text.slice(0, 200)}`, 'jupiter');
    }

    const quoteResponse = (await res.json()) as JupiterQuoteResponse;
    const buyRaw = BigInt(quoteResponse.outAmount);

    return {
      provider: 'jupiter',
      sell,
      buy,
      sellRaw,
      buyRaw,
      minBuyRaw: BigInt(quoteResponse.otherAmountThreshold),
      fee: {
        bps: fee.account ? DEV_FEE_BPS : 0,
        raw: quoteResponse.platformFee ? BigInt(quoteResponse.platformFee.amount) : 0n,
        asset: buy,
        recipient: SOLANA_FEE_OWNER,
        applied: Boolean(fee.account && quoteResponse.platformFee),
        reason: fee.reason,
      },
      priceImpactPct: quoteResponse.priceImpactPct ? Number(quoteResponse.priceImpactPct) * 100 : undefined,
      route: quoteResponse.routePlan?.map((r) => r.swapInfo?.label ?? 'unknown') ?? undefined,
      slippageBps,
      raw: { quoteResponse, mode, feeAccount: fee.account } satisfies JupiterRaw,
      fetchedAt: Date.now(),
    };
  },

  async execute({ quote, seed, accountIndex, onProgress }: SwapExecuteRequest): Promise<SwapResult> {
    const { quoteResponse, mode, feeAccount } = quote.raw as JupiterRaw;
    const { base, headers } = endpoints();
    const { VersionedTransaction } = await import('@solana/web3.js');

    const payer = solanaKeypair(seed, accountIndex);
    const connection = getConnection(mode);

    onProgress?.('building');
    const res = await fetch(`${base}/swap`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: payer.publicKey.toBase58(),
        ...(feeAccount ? { feeAccount } : {}),
        // Lets the user trade native SOL without holding wSOL.
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Jupiter could not build the swap (${res.status}): ${text.slice(0, 200)}`);
    }

    const { swapTransaction } = (await res.json()) as { swapTransaction: string };

    onProgress?.('signing');
    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
    tx.sign([payer]);

    onProgress?.('broadcasting');
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      maxRetries: 3,
      preflightCommitment: 'confirmed',
    });

    onProgress?.('confirming', signature);
    const latest = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({ signature, ...latest }, 'confirmed');

    return {
      hash: signature,
      explorerUrl: `https://explorer.solana.com/tx/${signature}${SOLANA[mode].explorerQuery}`,
    };
  },
};
