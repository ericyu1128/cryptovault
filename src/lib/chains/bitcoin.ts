import '@/lib/polyfills';

import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';

import { BTC_EXPLORER, ESPLORA } from './networks';
import type {
  BtcAddressType,
  ChainAdapter,
  ChainBalance,
  ChainMeta,
  DeriveOptions,
  DerivedAccount,
  FeeQuote,
  NetworkMode,
  SendParams,
  SendResult,
} from './types';

import { BITCOIN_META } from './meta';
export { BITCOIN_META };

const network = (mode: NetworkMode) => (mode === 'mainnet' ? btc.NETWORK : btc.TEST_NETWORK);

/**
 * BIP-84 = native SegWit (bc1q...), BIP-86 = Taproot (bc1p...).
 * Coin type 1 is the standard "all testnets" value.
 */
export function btcPath(type: BtcAddressType, mode: NetworkMode, account: number, index = 0): string {
  const purpose = type === 'taproot' ? 86 : 84;
  const coin = mode === 'mainnet' ? 0 : 1;
  return `m/${purpose}'/${coin}'/${account}'/0/${index}`;
}

interface BtcKey {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  address: string;
  script: Uint8Array;
  type: BtcAddressType;
  path: string;
}

function deriveKey(
  seed: Uint8Array,
  type: BtcAddressType,
  mode: NetworkMode,
  account: number,
): BtcKey {
  const path = btcPath(type, mode, account);
  const node = HDKey.fromMasterSeed(seed).derive(path);
  if (!node.privateKey || !node.publicKey) throw new Error('Bitcoin: derivation produced no key');

  const net = network(mode);
  const payment =
    type === 'taproot'
      ? btc.p2tr(node.publicKey.slice(1), undefined, net) // x-only internal key
      : btc.p2wpkh(node.publicKey, net);

  if (!payment.address) throw new Error('Bitcoin: could not encode address');

  return {
    privateKey: node.privateKey,
    publicKey: node.publicKey,
    address: payment.address,
    script: payment.script,
    type,
    path,
  };
}

/* ------------------------------------------------------------ esplora client */

async function esplora<T>(mode: NetworkMode, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ESPLORA[mode]}${path}`, { ...init, cache: 'no-store' });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bitcoin API ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

interface EsploraAddress {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
}

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number };
}

async function fetchUtxos(mode: NetworkMode, address: string): Promise<Utxo[]> {
  const utxos = await esplora<Utxo[]>(mode, `/address/${address}/utxo`);
  // Only spend confirmed coins - unconfirmed change can be replaced out from
  // under us and would make the transaction unrelayable.
  return utxos.filter((u) => u.status.confirmed).sort((a, b) => b.value - a.value);
}

async function recommendedFeeRate(mode: NetworkMode): Promise<number> {
  try {
    const fees = await esplora<Record<string, number>>(mode, '/v1/fees/recommended');
    return Math.max(1, Math.ceil(fees.halfHourFee ?? fees.fastestFee ?? 5));
  } catch {
    return mode === 'mainnet' ? 8 : 2;
  }
}

/* --------------------------------------------------------------- vsize math */

const INPUT_VBYTES: Record<BtcAddressType, number> = { segwit: 68, taproot: 58 };
const OUTPUT_VBYTES: Record<BtcAddressType, number> = { segwit: 31, taproot: 43 };
const OVERHEAD_VBYTES = 11;

function estimateVsize(inputs: number, type: BtcAddressType, outputs: number): number {
  return Math.ceil(OVERHEAD_VBYTES + inputs * INPUT_VBYTES[type] + outputs * OUTPUT_VBYTES[type]);
}

/** Largest-first accumulation: fewest inputs, therefore lowest fee. */
function selectCoins(utxos: Utxo[], target: bigint, feeRate: number, type: BtcAddressType) {
  const picked: Utxo[] = [];
  let total = 0n;
  for (const u of utxos) {
    picked.push(u);
    total += BigInt(u.value);
    const withChange = BigInt(Math.ceil(estimateVsize(picked.length, type, 2) * feeRate));
    const withoutChange = BigInt(Math.ceil(estimateVsize(picked.length, type, 1) * feeRate));
    if (total >= target + withChange) return { picked, total, fee: withChange, change: true };
    if (total >= target + withoutChange && total - target - withoutChange < 546n) {
      // Change would be dust - donate it to the miners instead of creating an
      // unspendable output.
      return { picked, total, fee: total - target, change: false };
    }
  }
  return null;
}

export function btcToSats(amount: string): bigint {
  const [whole, frac = ''] = amount.trim().split('.');
  const padded = (frac + '00000000').slice(0, 8);
  return BigInt(whole || '0') * 100_000_000n + BigInt(padded || '0');
}

/* ------------------------------------------------------------------ adapter */

export const bitcoinAdapter: ChainAdapter = {
  meta: BITCOIN_META,

  async derive(seed, { accountIndex, mode, btcAddressType = 'segwit' }: DeriveOptions) {
    const primary = deriveKey(seed, btcAddressType, mode, accountIndex);
    const alt = deriveKey(seed, btcAddressType === 'segwit' ? 'taproot' : 'segwit', mode, accountIndex);
    const account: DerivedAccount = {
      chain: 'bitcoin',
      address: primary.address,
      publicKey: hex.encode(primary.publicKey),
      derivationPath: primary.path,
      altAddress: { type: alt.type, address: alt.address, derivationPath: alt.path },
    };
    return account;
  },

  async getBalance(address, mode): Promise<ChainBalance> {
    const info = await esplora<EsploraAddress>(mode, `/address/${address}`);
    const confirmed = BigInt(info.chain_stats.funded_txo_sum - info.chain_stats.spent_txo_sum);
    const pending = BigInt(info.mempool_stats.funded_txo_sum - info.mempool_stats.spent_txo_sum);
    return {
      chain: 'bitcoin',
      raw: confirmed + pending,
      decimals: 8,
      symbol: 'BTC',
      unfunded: info.chain_stats.tx_count === 0 && info.mempool_stats.tx_count === 0,
    };
  },

  async estimateFee({ mode, btcAddressType = 'segwit', feeRate }): Promise<FeeQuote> {
    const rate = feeRate ?? (await recommendedFeeRate(mode));
    const vsize = estimateVsize(1, btcAddressType, 2);
    return {
      raw: BigInt(Math.ceil(vsize * rate)),
      decimals: 8,
      symbol: 'BTC',
      label: 'Network fee (1-in / 2-out estimate)',
      detail: `${rate} sat/vB`,
    };
  },

  async send({ seed, mode, accountIndex, to, amount, btcAddressType = 'segwit', feeRate }: SendParams): Promise<SendResult> {
    const key = deriveKey(seed, btcAddressType, mode, accountIndex);
    const net = network(mode);

    if (!this.validateAddress(to, mode)) throw new Error(`"${to}" is not a valid Bitcoin address for this network`);

    const target = btcToSats(amount);
    if (target < 546n) throw new Error('Amount is below the 546 sat dust limit');

    const [utxos, rate] = await Promise.all([
      fetchUtxos(mode, key.address),
      feeRate ? Promise.resolve(feeRate) : recommendedFeeRate(mode),
    ]);
    if (utxos.length === 0) throw new Error('No confirmed UTXOs available to spend');

    const selection = selectCoins(utxos, target, rate, btcAddressType);
    if (!selection) {
      const total = utxos.reduce((s, u) => s + BigInt(u.value), 0n);
      throw new Error(
        `Insufficient funds: have ${total} sats, need ${target} sats plus fee at ${rate} sat/vB`,
      );
    }

    const tx = new btc.Transaction();
    for (const u of selection.picked) {
      tx.addInput({
        txid: u.txid,
        index: u.vout,
        witnessUtxo: { script: key.script, amount: BigInt(u.value) },
        ...(btcAddressType === 'taproot' ? { tapInternalKey: key.publicKey.slice(1) } : {}),
      });
    }

    tx.addOutputAddress(to, target, net);
    if (selection.change) {
      const change = selection.total - target - selection.fee;
      if (change >= 546n) tx.addOutputAddress(key.address, change, net);
    }

    tx.sign(key.privateKey);
    tx.finalize();

    const rawHex = tx.hex;
    const txid = await esplora<string>(mode, '/tx', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: rawHex,
    });

    const id = typeof txid === 'string' ? txid.trim() : tx.id;
    return { hash: id, explorerUrl: this.explorerTx(id, mode) };
  },

  validateAddress(address, mode) {
    try {
      const decoded = btc.Address(network(mode)).decode(address.trim());
      return Boolean(decoded);
    } catch {
      return false;
    }
  },

  explorerAddress: (address, mode) => `${BTC_EXPLORER[mode]}/address/${address}`,
  explorerTx: (hash, mode) => `${BTC_EXPLORER[mode]}/tx/${hash}`,
};
