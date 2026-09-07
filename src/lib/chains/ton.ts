import '@/lib/polyfills';

import {
  Address,
  Cell,
  SendMode,
  beginCell,
  external,
  internal,
  storeMessage,
  toNano,
} from '@ton/core';
import { keyPairFromSeed } from '@ton/crypto';
import { TonClient, WalletContractV4 } from '@ton/ton';

import { slip10DeriveEd25519 } from '@/lib/crypto/slip10';
import { TON } from './networks';
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

import { TON_META } from './meta';
export { TON_META };

/**
 * SLIP-0010 ed25519 at m/44'/607'/N' - the same path Trust Wallet uses for TON.
 *
 * Heads up: this is NOT the same as TON's own 24-word mnemonic scheme used by
 * Tonkeeper. Importing this phrase into Tonkeeper will produce a different
 * address. Use the address shown here as the source of truth.
 */
export function tonPath(account: number): string {
  return `m/44'/607'/${account}'`;
}

export function tonKeyPair(seed: Uint8Array, accountIndex: number) {
  const { key } = slip10DeriveEd25519(tonPath(accountIndex), seed);
  return keyPairFromSeed(Buffer.from(key));
}

export function tonWallet(seed: Uint8Array, accountIndex: number): WalletContractV4 {
  const { publicKey } = tonKeyPair(seed, accountIndex);
  return WalletContractV4.create({ workchain: 0, publicKey });
}

const clientCache = new Map<string, TonClient>();

export function getTonClient(mode: NetworkMode): TonClient {
  const cfg = TON[mode];
  let c = clientCache.get(cfg.rpc);
  if (!c) {
    c = new TonClient({ endpoint: cfg.rpc, apiKey: cfg.apiKey });
    clientCache.set(cfg.rpc, c);
  }
  return c;
}

/** User-facing TON addresses are non-bounceable (UQ… / 0Q…) for wallets. */
export function formatTonAddress(address: Address, mode: NetworkMode): string {
  return address.toString({ bounceable: false, testOnly: mode === 'testnet', urlSafe: true });
}

export const tonAdapter: ChainAdapter = {
  meta: TON_META,

  async derive(seed, { accountIndex, mode }: DeriveOptions) {
    const { publicKey } = tonKeyPair(seed, accountIndex);
    const wallet = WalletContractV4.create({ workchain: 0, publicKey });
    const account: DerivedAccount = {
      chain: 'ton',
      address: formatTonAddress(wallet.address, mode),
      publicKey: publicKey.toString('hex'),
      derivationPath: tonPath(accountIndex),
    };
    return account;
  },

  async getBalance(address, mode): Promise<ChainBalance> {
    const client = getTonClient(mode);
    const parsed = Address.parse(address);
    const raw = await client.getBalance(parsed);
    const deployed = await client.isContractDeployed(parsed).catch(() => false);
    return {
      chain: 'ton',
      raw,
      decimals: 9,
      symbol: 'TON',
      unfunded: !deployed && raw === 0n,
    };
  },

  async estimateFee(): Promise<FeeQuote> {
    // A V4 wallet -> wallet transfer costs a few million nanotons. TON forwards
    // any unused gas back to the sender, so this is an upper bound.
    return {
      raw: 5_000_000n,
      decimals: 9,
      symbol: 'TON',
      label: 'Estimated network fee',
      detail: '~0.005 TON (unused gas is refunded)',
    };
  },

  async send({ seed, mode, accountIndex, to, amount, memo }: SendParams): Promise<SendResult> {
    if (!this.validateAddress(to, mode)) throw new Error(`"${to}" is not a valid TON address`);

    const client = getTonClient(mode);
    const keys = tonKeyPair(seed, accountIndex);
    const wallet = WalletContractV4.create({ workchain: 0, publicKey: keys.publicKey });
    const opened = client.open(wallet);

    const deployed = await client.isContractDeployed(wallet.address).catch(() => false);
    const seqno = deployed ? await opened.getSeqno() : 0;

    const transfer = wallet.createTransfer({
      seqno,
      secretKey: keys.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: [
        internal({
          to: Address.parse(to.trim()),
          value: toNano(amount),
          // Never bounce to a plain wallet: a bounced transfer burns the fee.
          bounce: false,
          body: memo && memo.length > 0 ? memo : undefined,
        }),
      ],
    });

    // Build the external message ourselves so we can hash it - that hash is what
    // tonviewer/tonscan index the transaction under.
    const ext = external({
      to: wallet.address,
      init: seqno === 0 ? wallet.init : undefined,
      body: transfer as Cell,
    });
    const boc = beginCell().store(storeMessage(ext)).endCell();
    const hash = boc.hash().toString('hex');

    await client.sendFile(boc.toBoc());

    return { hash, explorerUrl: this.explorerTx(hash, mode) };
  },

  validateAddress(address, mode) {
    try {
      const parsed = Address.parseFriendly(address.trim());
      // Reject a mainnet address pasted while on testnet and vice versa.
      return parsed.isTestOnly === (mode === 'testnet') || !parsed.isTestOnly;
    } catch {
      try {
        Address.parse(address.trim());
        return true;
      } catch {
        return false;
      }
    }
  },

  explorerAddress: (address, mode) => `${TON[mode].explorer}/${address}`,
  explorerTx: (hash, mode) => `${TON[mode].explorer}/transaction/${hash}`,
};
