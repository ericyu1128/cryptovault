import '@/lib/polyfills';

import {
  Contract,
  HDNodeWallet,
  JsonRpcProvider,
  Mnemonic,
  formatEther,
  formatUnits,
  isAddress,
  parseEther,
  parseUnits,
} from 'ethers';

import { EVM_CHAINS } from './networks';
import { EVM_META, BSC_META } from './meta';
import { findToken, tokensFor } from './tokens';
import type {
  ChainAdapter,
  ChainBalance,
  DeriveOptions,
  DerivedAccount,
  EvmChainId,
  FeeQuote,
  NetworkMode,
  SendParams,
  SendResult,
  TokenBalance,
} from './types';

export { EVM_META, BSC_META };

/**
 * Read ABI. Used for view calls where the return value must decode.
 */
export const ERC20_MIN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
] as const;

/**
 * Write ABI, declared with NO return values on purpose.
 *
 * USDT on Ethereum declares `transfer` and `approve` as returning nothing
 * rather than `bool`. ethers does not decode return data for state-changing
 * calls, so omitting the return type here is correct for standard tokens and
 * is the only thing that works for the non-standard ones.
 */
export const ERC20_WRITE_ABI = [
  'function transfer(address to, uint256 value)',
  'function approve(address spender, uint256 value)',
] as const;

export function evmPath(account: number, index = 0): string {
  return `m/44'/60'/${account}'/0/${index}`;
}

/* -------------------------------------------------------------- providers */

const providerCache = new Map<string, JsonRpcProvider>();

export function getProviderFor(chain: EvmChainId, mode: NetworkMode): JsonRpcProvider {
  const net = EVM_CHAINS[chain][mode];
  let p = providerCache.get(net.rpc);
  if (!p) {
    p = new JsonRpcProvider(
      net.rpc,
      { chainId: net.chainId, name: net.name },
      {
        staticNetwork: true,
        // Never serve a cached nonce or balance. ethers caches RPC responses for
        // 250 ms by default, which is long enough for two actions in a row
        // (estimate then deploy, or two sends) to reuse a stale nonce and get
        // rejected with NONCE_EXPIRED.
        cacheTimeout: -1,
        // Several public endpoints reject JSON-RPC batches; one call per request
        // costs a little latency and works everywhere.
        batchMaxCount: 1,
      },
    );
    providerCache.set(net.rpc, p);
  }
  return p;
}

/** Back-compat: the Ethereum provider, used by the token deployer. */
export function getProvider(mode: NetworkMode): JsonRpcProvider {
  return getProviderFor('ethereum', mode);
}

/* ---------------------------------------------------------------- wallets */

export function evmWalletFor(
  seed: Uint8Array,
  accountIndex: number,
  chain: EvmChainId,
  mode: NetworkMode,
): HDNodeWallet {
  const root = HDNodeWallet.fromSeed(seed);
  return root.derivePath(evmPath(accountIndex).replace(/^m\//, '')).connect(getProviderFor(chain, mode));
}

/** Back-compat for the deployer, which is Ethereum-only. */
export function evmWallet(seed: Uint8Array, accountIndex: number, mode: NetworkMode): HDNodeWallet {
  return evmWalletFor(seed, accountIndex, 'ethereum', mode);
}

export function evmWalletFromPhrase(phrase: string, accountIndex: number): HDNodeWallet {
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(phrase), evmPath(accountIndex));
}

/* ------------------------------------------------------------ ERC-20 reads */

const decimalsCache = new Map<string, number>();

/**
 * The on-chain decimals for a token, cached per (chain, network, address).
 *
 * Registry decimals are advisory only. Every write path resolves through here
 * first, because BSC stablecoins use 18 where their Ethereum counterparts use
 * 6 - trusting a hardcoded value there misprices a transfer by 10^12.
 */
export async function resolveDecimals(
  tokenAddress: string,
  chain: EvmChainId,
  mode: NetworkMode,
): Promise<number> {
  const key = `${chain}:${mode}:${tokenAddress.toLowerCase()}`;
  const hit = decimalsCache.get(key);
  if (hit !== undefined) return hit;

  const contract = new Contract(tokenAddress, ERC20_MIN_ABI, getProviderFor(chain, mode));
  const decimals = Number((await contract.decimals()) as bigint);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`${tokenAddress} reported an implausible decimals value (${decimals})`);
  }
  decimalsCache.set(key, decimals);
  return decimals;
}

export async function fetchTokenBalanceOn(
  tokenAddress: string,
  owner: string,
  chain: EvmChainId,
  mode: NetworkMode,
): Promise<TokenBalance> {
  const contract = new Contract(tokenAddress, ERC20_MIN_ABI, getProviderFor(chain, mode));
  const [name, symbol, decimals, raw] = await Promise.all([
    contract.name() as Promise<string>,
    contract.symbol() as Promise<string>,
    resolveDecimals(tokenAddress, chain, mode),
    contract.balanceOf(owner) as Promise<bigint>,
  ]);
  return { address: tokenAddress, name, symbol, decimals, raw };
}

/** Back-compat wrapper used by the existing Ethereum token list. */
export async function fetchTokenBalance(
  tokenAddress: string,
  owner: string,
  mode: NetworkMode,
): Promise<TokenBalance> {
  return fetchTokenBalanceOn(tokenAddress, owner, 'ethereum', mode);
}

/** Balances for every registry token on a chain, failures isolated per token. */
export async function fetchRegistryTokenBalances(
  owner: string,
  chain: EvmChainId,
  mode: NetworkMode,
): Promise<TokenBalance[]> {
  const results = await Promise.allSettled(
    tokensFor(chain, mode).map((t) => fetchTokenBalanceOn(t.address, owner, chain, mode)),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<TokenBalance> => r.status === 'fulfilled')
    .map((r) => r.value);
}

/* ----------------------------------------------------------- ERC-20 writes */

/**
 * Ensure `spender` may move `amount` of `tokenAddress` on the owner's behalf.
 *
 * Handles the USDT class of token that reverts when a non-zero allowance is
 * changed to another non-zero value: the allowance is reset to 0 first. This is
 * the single most common reason a swap UI works for every token except USDT.
 *
 * Returns the approval transaction hashes that were actually broadcast.
 */
export async function ensureAllowance(params: {
  seed: Uint8Array;
  accountIndex: number;
  chain: EvmChainId;
  mode: NetworkMode;
  tokenAddress: string;
  spender: string;
  amount: bigint;
  onProgress?: (stage: 'reset' | 'approve', hash: string) => void;
}): Promise<string[]> {
  const { seed, accountIndex, chain, mode, tokenAddress, spender, amount, onProgress } = params;
  const wallet = evmWalletFor(seed, accountIndex, chain, mode);
  const provider = getProviderFor(chain, mode);

  const reader = new Contract(tokenAddress, ERC20_MIN_ABI, provider);
  const current = (await reader.allowance(wallet.address, spender)) as bigint;
  if (current >= amount) return [];

  const writer = new Contract(tokenAddress, ERC20_WRITE_ABI, wallet);
  const hashes: string[] = [];

  const known = findToken(chain, mode, tokenAddress)?.quirks?.includes('zero-before-approve');
  const resetFirst = current > 0n && known === true;

  async function reset(): Promise<void> {
    const tx = await writer.approve(spender, 0n);
    hashes.push(tx.hash);
    onProgress?.('reset', tx.hash);
    await tx.wait(1);
  }

  if (resetFirst) await reset();

  try {
    const tx = await writer.approve(spender, amount);
    hashes.push(tx.hash);
    onProgress?.('approve', tx.hash);
    await tx.wait(1);
  } catch (err) {
    // An unlisted token can have the same quirk. If the direct approve failed
    // while an allowance was already set, zero it and try once more rather than
    // dead-ending the user on a token we simply had not catalogued.
    if (resetFirst || current === 0n) throw err;
    await reset();
    const tx = await writer.approve(spender, amount);
    hashes.push(tx.hash);
    onProgress?.('approve', tx.hash);
    await tx.wait(1);
  }

  return hashes;
}

/* ---------------------------------------------------------------- adapter */

function createEvmAdapter(chain: EvmChainId): ChainAdapter {
  const meta = chain === 'bsc' ? BSC_META : EVM_META;

  const adapter: ChainAdapter = {
    meta,

    async derive(seed, { accountIndex }: DeriveOptions) {
      const root = HDNodeWallet.fromSeed(seed);
      const node = root.derivePath(evmPath(accountIndex).replace(/^m\//, ''));
      // Ethereum and BSC share an address: same curve, same derivation path.
      return {
        chain,
        address: node.address,
        publicKey: node.publicKey.replace(/^0x/, ''),
        derivationPath: evmPath(accountIndex),
      };
    },

    async getBalance(address, mode): Promise<ChainBalance> {
      const raw = await getProviderFor(chain, mode).getBalance(address);
      return {
        chain,
        raw,
        decimals: 18,
        symbol: EVM_CHAINS[chain][mode].symbol,
        unfunded: raw === 0n,
      };
    },

    async estimateFee({ mode, tokenAddress }): Promise<FeeQuote> {
      const fee = await getProviderFor(chain, mode).getFeeData();
      const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
      const gasLimit = tokenAddress ? 65_000n : 21_000n;
      const symbol = EVM_CHAINS[chain][mode].symbol;
      return {
        raw: gasPrice * gasLimit,
        decimals: 18,
        symbol,
        label: tokenAddress ? 'Estimated gas (token transfer)' : 'Estimated gas (native transfer)',
        detail: `${formatUnits(gasPrice, 'gwei')} gwei x ${gasLimit} gas`,
      };
    },

    async send({ seed, mode, accountIndex, to, amount, tokenAddress, memo }: SendParams): Promise<SendResult> {
      if (!isAddress(to)) throw new Error(`"${to}" is not a valid EVM address`);
      const wallet = evmWalletFor(seed, accountIndex, chain, mode);

      if (tokenAddress) {
        if (!isAddress(tokenAddress)) throw new Error('Invalid token contract address');
        // Always the on-chain value, never the registry's advisory number.
        const decimals = await resolveDecimals(tokenAddress, chain, mode);
        const contract = new Contract(tokenAddress, ERC20_WRITE_ABI, wallet);
        const tx = await contract.transfer(to, parseUnits(amount, decimals));
        return { hash: tx.hash, explorerUrl: adapter.explorerTx(tx.hash, mode) };
      }

      const tx = await wallet.sendTransaction({
        to,
        value: parseEther(amount),
        ...(memo ? { data: '0x' + Buffer.from(memo, 'utf8').toString('hex') } : {}),
      });
      return { hash: tx.hash, explorerUrl: adapter.explorerTx(tx.hash, mode) };
    },

    validateAddress: (address) => isAddress(address.trim()),
    explorerAddress: (address, mode) => `${EVM_CHAINS[chain][mode].explorer}/address/${address}`,
    explorerTx: (hash, mode) => `${EVM_CHAINS[chain][mode].explorer}/tx/${hash}`,
  };

  return adapter;
}

export const evmAdapter = createEvmAdapter('ethereum');
export const bscAdapter = createEvmAdapter('bsc');

export { formatEther, parseEther, formatUnits, parseUnits, isAddress, Contract };
export { ContractFactory } from 'ethers';
