import '@/lib/polyfills';

import { CHAIN_METAS } from '@/lib/chains/meta';
import { EVM_CHAINS } from '@/lib/chains/networks';
import { NATIVE_TOKEN_SENTINEL, tokensFor } from '@/lib/chains/tokens';
import { ensureAllowance, evmWalletFor } from '@/lib/chains/evm';
import type { ChainId, EvmChainId, NetworkMode } from '@/lib/chains/types';
import { isEvmChain } from '@/lib/chains/types';
import { DEV_FEE_BPS, EVM_FEE_RECIPIENT, applySlippage, evmFeeTokenPreference } from './fees';
import {
  SwapQuoteError,
  type SwapAsset,
  type SwapExecuteRequest,
  type SwapProvider,
  type SwapQuote,
  type SwapQuoteRequest,
  type SwapResult,
} from './types';

/**
 * 0x Swap API v2, allowance-holder flow.
 *
 * Chosen over the Permit2 flow because allowance-holder needs only a plain
 * ERC-20 approval, which we can do with the key we already hold - Permit2 would
 * add an EIP-712 signature and signature-splicing step for no benefit here.
 */
const BASE_URL = 'https://api.0x.org/swap/allowance-holder';

function apiKey(): string {
  const key = process.env.NEXT_PUBLIC_ZEROX_API_KEY;
  if (!key) {
    throw new SwapQuoteError(
      'No 0x API key configured. Set NEXT_PUBLIC_ZEROX_API_KEY in .env.local to enable EVM swaps.',
      '0x',
    );
  }
  return key;
}

interface ZeroExQuoteResponse {
  liquidityAvailable: boolean;
  buyAmount: string;
  minBuyAmount: string;
  sellAmount: string;
  totalNetworkFee?: string;
  fees?: {
    integratorFee?: { amount: string; token: string } | null;
    zeroExFee?: { amount: string; token: string } | null;
  };
  issues?: {
    allowance?: { actual: string; spender: string } | null;
    balance?: { token: string; actual: string; expected: string } | null;
  };
  route?: { fills?: Array<{ source: string; proportionBps?: string }> };
  transaction?: { to: string; data: string; gas?: string; gasPrice?: string; value?: string };
  zid?: string;
}

interface ZeroExRaw {
  response: ZeroExQuoteResponse;
  chain: EvmChainId;
  mode: NetworkMode;
}

async function callZeroEx(params: URLSearchParams): Promise<ZeroExQuoteResponse> {
  const res = await fetch(`${BASE_URL}/quote?${params.toString()}`, {
    headers: { '0x-api-key': apiKey(), '0x-version': 'v2' },
    cache: 'no-store',
  });

  const body = (await res.json().catch(() => ({}))) as ZeroExQuoteResponse & {
    reason?: string;
    validationErrors?: Array<{ field?: string; reason?: string; description?: string }>;
  };

  if (!res.ok) {
    const detail =
      body.validationErrors?.map((e) => `${e.field ?? ''} ${e.description ?? e.reason ?? ''}`.trim()).join('; ') ||
      body.reason ||
      `HTTP ${res.status}`;
    throw new SwapQuoteError(
      detail,
      '0x',
      // A fee-token complaint is worth retrying with a different fee token.
      /fee/i.test(detail),
    );
  }
  return body;
}

export function zeroExAssets(chain: ChainId, mode: NetworkMode): SwapAsset[] {
  const meta = CHAIN_METAS[chain];
  if (!isEvmChain(chain)) return [];
  const net = EVM_CHAINS[chain][mode];

  const native: SwapAsset = {
    chain,
    mode,
    address: NATIVE_TOKEN_SENTINEL,
    symbol: net.symbol,
    name: meta.name,
    decimals: 18,
    native: true,
  };

  const tokens: SwapAsset[] = tokensFor(chain, mode).map((t) => ({
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

export const zeroExProvider: SwapProvider = {
  id: '0x',
  label: '0x Swap API',

  supports(chain, mode) {
    return isEvmChain(chain) && EVM_CHAINS[chain][mode].swapSupported;
  },

  listAssets: zeroExAssets,

  async quote(request: SwapQuoteRequest): Promise<SwapQuote> {
    const { chain, mode, sell, buy, sellRaw, slippageBps, taker } = request;
    if (!isEvmChain(chain)) throw new SwapQuoteError(`${chain} is not an EVM chain`, '0x');
    const net = EVM_CHAINS[chain][mode];

    const feeCandidates = evmFeeTokenPreference(sell, buy);
    let lastError: SwapQuoteError | null = null;

    // Try each acceptable fee token, then fall back to a fee-free quote rather
    // than denying the user a swap because our fee could not be attached.
    for (const feeToken of [...feeCandidates, null]) {
      const params = new URLSearchParams({
        chainId: String(net.chainId),
        sellToken: sell.address,
        buyToken: buy.address,
        sellAmount: sellRaw.toString(),
        taker,
        slippageBps: String(slippageBps),
      });

      if (feeToken) {
        params.set('swapFeeRecipient', EVM_FEE_RECIPIENT);
        params.set('swapFeeBps', String(DEV_FEE_BPS));
        params.set('swapFeeToken', feeToken.address);
      }

      try {
        const response = await callZeroEx(params);
        if (!response.liquidityAvailable) {
          throw new SwapQuoteError('No liquidity available for this pair', '0x');
        }

        const buyRaw = BigInt(response.buyAmount);
        const integrator = response.fees?.integratorFee;
        const feeAsset = feeToken ?? buy;

        return {
          provider: '0x',
          sell,
          buy,
          sellRaw,
          buyRaw,
          minBuyRaw: response.minBuyAmount ? BigInt(response.minBuyAmount) : applySlippage(buyRaw, slippageBps),
          fee: {
            bps: feeToken ? DEV_FEE_BPS : 0,
            raw: integrator ? BigInt(integrator.amount) : 0n,
            asset: feeAsset,
            recipient: EVM_FEE_RECIPIENT,
            applied: Boolean(feeToken && integrator),
            reason: feeToken
              ? undefined
              : '0x rejected every eligible fee token for this pair; the trade runs at 0%.',
          },
          gasRaw: response.totalNetworkFee ? BigInt(response.totalNetworkFee) : undefined,
          route: response.route?.fills?.map((f) => f.source) ?? undefined,
          slippageBps,
          raw: { response, chain, mode } satisfies ZeroExRaw,
          fetchedAt: Date.now(),
        };
      } catch (err) {
        const error = err instanceof SwapQuoteError ? err : new SwapQuoteError(String(err), '0x');
        lastError = error;
        // Only a fee-related complaint is worth another attempt.
        if (!error.retryable) {
          if (feeToken === null) throw error;
          if (!/fee/i.test(error.message)) throw error;
        }
      }
    }

    throw lastError ?? new SwapQuoteError('Could not fetch a quote', '0x');
  },

  async execute({ quote, seed, accountIndex, onProgress }: SwapExecuteRequest): Promise<SwapResult> {
    const { response, chain, mode } = quote.raw as ZeroExRaw;
    if (!response.transaction) throw new Error('0x returned no transaction to submit');

    const wallet = evmWalletFor(seed, accountIndex, chain, mode);
    const approvalHashes: string[] = [];

    // Native sells need no allowance; ERC-20 sells do.
    if (response.issues?.allowance && !quote.sell.native) {
      onProgress?.('checking-allowance');
      const hashes = await ensureAllowance({
        seed,
        accountIndex,
        chain,
        mode,
        tokenAddress: quote.sell.address,
        spender: response.issues.allowance.spender,
        amount: quote.sellRaw,
        onProgress: (stage, hash) =>
          onProgress?.(stage === 'reset' ? 'resetting-allowance' : 'approving', hash),
      });
      approvalHashes.push(...hashes);
    }

    onProgress?.('signing');
    const tx = await wallet.sendTransaction({
      to: response.transaction.to,
      data: response.transaction.data,
      value: BigInt(response.transaction.value ?? '0'),
      ...(response.transaction.gas ? { gasLimit: BigInt(response.transaction.gas) } : {}),
    });

    onProgress?.('confirming', tx.hash);
    await tx.wait(1);

    return {
      hash: tx.hash,
      explorerUrl: `${EVM_CHAINS[chain][mode].explorer}/tx/${tx.hash}`,
      approvalHashes: approvalHashes.length ? approvalHashes : undefined,
    };
  },
};
