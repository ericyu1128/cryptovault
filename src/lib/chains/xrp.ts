import '@/lib/polyfills';

import { HDKey } from '@scure/bip32';
import { hex } from '@scure/base';
import { Wallet, isValidClassicAddress, xrpToDrops } from 'xrpl';
import type { Payment } from 'xrpl';

import { XRPL } from './networks';
import type {
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

import { XRP_META } from './meta';
export { XRP_META };

export function xrpPath(account: number): string {
  return `m/44'/144'/${account}'/0/0`;
}

/**
 * Mirrors exactly what xrpl.js `Wallet.fromMnemonic(..., {mnemonicEncoding:'bip39'})`
 * does, but starting from the seed we already hold rather than re-deriving from
 * the phrase. secp256k1 private keys are prefixed with `00` on the XRPL.
 */
export function xrpWallet(seed: Uint8Array, accountIndex: number): Wallet {
  const node = HDKey.fromMasterSeed(seed).derive(xrpPath(accountIndex));
  if (!node.privateKey || !node.publicKey) throw new Error('XRP: derivation produced no key');
  const publicKey = hex.encode(node.publicKey).toUpperCase();
  const privateKey = `00${hex.encode(node.privateKey).toUpperCase()}`;
  return new Wallet(publicKey, privateKey);
}

/* ------------------------------------------------------- JSON-RPC transport */

/**
 * We talk to rippled over plain HTTP JSON-RPC rather than xrpl.js's WebSocket
 * Client: no socket lifecycle to babysit in a browser tab, no `ws` polyfill,
 * and every call is a single stateless fetch.
 */
async function rpc<T>(mode: NetworkMode, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(XRPL[mode].rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`XRPL RPC ${res.status}`);
  const json = (await res.json()) as { result: T & { error?: string; error_message?: string } };
  const result = json.result;
  if (result?.error && result.error !== 'actNotFound') {
    throw new Error(result.error_message ?? result.error);
  }
  return result;
}

interface AccountInfoResult {
  account_data?: { Balance: string; Sequence: number; OwnerCount: number };
  ledger_current_index?: number;
  error?: string;
  validated?: boolean;
}

interface ServerInfoResult {
  info: { validated_ledger?: { seq: number; reserve_base_xrp: number; reserve_inc_xrp: number } };
}

export async function getAccountInfo(mode: NetworkMode, address: string): Promise<AccountInfoResult> {
  return rpc<AccountInfoResult>(mode, 'account_info', {
    account: address,
    ledger_index: 'current',
    strict: true,
  });
}

export const xrpAdapter: ChainAdapter = {
  meta: XRP_META,

  async derive(seed, { accountIndex }: DeriveOptions) {
    const wallet = xrpWallet(seed, accountIndex);
    const account: DerivedAccount = {
      chain: 'xrp',
      address: wallet.classicAddress,
      publicKey: wallet.publicKey,
      derivationPath: xrpPath(accountIndex),
    };
    return account;
  },

  async getBalance(address, mode): Promise<ChainBalance> {
    const [info, server] = await Promise.all([
      getAccountInfo(mode, address),
      rpc<ServerInfoResult>(mode, 'server_info').catch(() => null),
    ]);

    if (!info.account_data) {
      // account_not_found simply means nobody has funded this address yet.
      return { chain: 'xrp', raw: 0n, decimals: 6, symbol: 'XRP', unfunded: true };
    }

    const ledger = server?.info.validated_ledger;
    const baseReserve = ledger ? BigInt(Math.round(ledger.reserve_base_xrp * 1_000_000)) : 1_000_000n;
    const ownerReserve = ledger
      ? BigInt(info.account_data.OwnerCount) * BigInt(Math.round(ledger.reserve_inc_xrp * 1_000_000))
      : 0n;

    return {
      chain: 'xrp',
      raw: BigInt(info.account_data.Balance),
      decimals: 6,
      symbol: 'XRP',
      reservedRaw: baseReserve + ownerReserve,
    };
  },

  async estimateFee({ mode }): Promise<FeeQuote> {
    try {
      const fee = await rpc<{ drops: { open_ledger_fee: string; minimum_fee: string } }>(mode, 'fee');
      const drops = BigInt(fee.drops.open_ledger_fee || fee.drops.minimum_fee || '12');
      return {
        raw: drops < 12n ? 12n : drops,
        decimals: 6,
        symbol: 'XRP',
        label: 'Ledger fee',
        detail: `${drops} drops`,
      };
    } catch {
      return { raw: 12n, decimals: 6, symbol: 'XRP', label: 'Ledger fee', detail: '12 drops' };
    }
  },

  async send({ seed, mode, accountIndex, to, amount, memo }: SendParams): Promise<SendResult> {
    if (!isValidClassicAddress(to.trim())) throw new Error(`"${to}" is not a valid XRP address`);

    const wallet = xrpWallet(seed, accountIndex);
    const info = await getAccountInfo(mode, wallet.classicAddress);
    if (!info.account_data) {
      throw new Error('This XRP account is not activated yet - it must first receive the base reserve');
    }

    const feeQuote = await this.estimateFee({ mode, accountIndex, to, amount });
    const ledgerIndex = info.ledger_current_index ?? 0;

    const payment: Payment = {
      TransactionType: 'Payment',
      Account: wallet.classicAddress,
      Destination: to.trim(),
      Amount: xrpToDrops(amount),
      Fee: feeQuote.raw.toString(),
      Sequence: info.account_data.Sequence,
      ...(ledgerIndex ? { LastLedgerSequence: ledgerIndex + 20 } : {}),
    };

    // A numeric memo is treated as a destination tag - exchanges require it.
    if (memo && /^\d+$/.test(memo.trim())) {
      payment.DestinationTag = Number(memo.trim());
    }

    const { tx_blob, hash } = wallet.sign(payment);

    const submitted = await rpc<{ engine_result: string; engine_result_message: string }>(
      mode,
      'submit',
      { tx_blob },
    );

    // tesSUCCESS / terQUEUED are the only outcomes that mean "it is on its way".
    if (!/^(tesSUCCESS|terQUEUED)$/.test(submitted.engine_result)) {
      throw new Error(`${submitted.engine_result}: ${submitted.engine_result_message}`);
    }

    return { hash, explorerUrl: this.explorerTx(hash, mode) };
  },

  validateAddress: (address) => isValidClassicAddress(address.trim()),
  explorerAddress: (address, mode) => `${XRPL[mode].explorer}/accounts/${address}`,
  explorerTx: (hash, mode) => `${XRPL[mode].explorer}/transactions/${hash}`,
};
