import '@/lib/polyfills';

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

import { slip10DeriveEd25519 } from '@/lib/crypto/slip10';
import { SOLANA } from './networks';
import { findToken } from './tokens';
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
  TokenBalance,
} from './types';

import { SOLANA_META } from './meta';
export { SOLANA_META };

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** Phantom/Backpack-compatible path. Every segment is hardened (ed25519). */
export function solanaPath(account: number): string {
  return `m/44'/501'/${account}'/0'`;
}

export function solanaKeypair(seed: Uint8Array, accountIndex: number): Keypair {
  const { key } = slip10DeriveEd25519(solanaPath(accountIndex), seed);
  return Keypair.fromSeed(key);
}

const connectionCache = new Map<string, Connection>();

export function getConnection(mode: NetworkMode): Connection {
  const url = SOLANA[mode].rpc;
  let c = connectionCache.get(url);
  if (!c) {
    c = new Connection(url, 'confirmed');
    connectionCache.set(url, c);
  }
  return c;
}

export function solToLamports(amount: string): bigint {
  const [whole, frac = ''] = amount.trim().split('.');
  const padded = (frac + '000000000').slice(0, 9);
  return BigInt(whole || '0') * BigInt(LAMPORTS_PER_SOL) + BigInt(padded || '0');
}

/** SPL token holdings, read straight from the token program's parsed accounts. */
export async function fetchSplTokens(owner: string, mode: NetworkMode): Promise<TokenBalance[]> {
  const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await import('@solana/spl-token');
  const connection = getConnection(mode);
  const ownerKey = new PublicKey(owner);

  // Token-2022 mints live under a different program, so both must be queried.
  const responses = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      connection
        .getParsedTokenAccountsByOwner(ownerKey, { programId })
        .catch(() => ({ value: [] as never[] })),
    ),
  );

  return responses
    .flatMap((res) => res.value)
    .map((acc) => {
      const info = acc.account.data.parsed.info as {
        mint: string;
        tokenAmount: { amount: string; decimals: number };
      };
      const known = findToken('solana', mode, info.mint);
      return {
        address: info.mint,
        name: known?.name ?? info.mint,
        symbol: known?.symbol ?? `${info.mint.slice(0, 4)}…`,
        decimals: info.tokenAmount.decimals,
        raw: BigInt(info.tokenAmount.amount),
      };
    })
    .filter((t) => t.raw > 0n);
}

/** The token program that actually owns a mint (classic SPL or Token-2022). */
async function mintProgramId(mint: PublicKey, mode: NetworkMode): Promise<PublicKey> {
  const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await import('@solana/spl-token');
  const info = await getConnection(mode).getAccountInfo(mint);
  if (!info) throw new Error(`Mint ${mint.toBase58()} does not exist on this network`);
  return info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

/**
 * Transfer an SPL token.
 *
 * Uses `transferChecked` rather than `transfer` on purpose: it re-validates the
 * decimals on chain, so a mismatch between our registry and reality aborts the
 * transaction instead of moving the wrong amount by a factor of 10^n.
 *
 * If the recipient has no associated token account for this mint, one is
 * created as part of the same transaction. That costs the sender roughly
 * 0.002 SOL of rent, which the UI warns about before signing.
 */
export async function sendSplToken(params: {
  seed: Uint8Array;
  accountIndex: number;
  mode: NetworkMode;
  mintAddress: string;
  to: string;
  /** Decimal string in whole tokens. */
  amount: string;
}): Promise<{ signature: string; createdRecipientAccount: boolean }> {
  const { seed, accountIndex, mode, mintAddress, to, amount } = params;
  const {
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    createTransferCheckedInstruction,
    getMint,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  } = await import('@solana/spl-token');

  const connection = getConnection(mode);
  const payer = solanaKeypair(seed, accountIndex);
  const mint = new PublicKey(mintAddress);
  const recipient = new PublicKey(to.trim());

  const programId = await mintProgramId(mint, mode);
  // Authoritative decimals, straight from the mint account.
  const mintInfo = await getMint(connection, mint, undefined, programId);
  const value = parseTokenAmount(amount, mintInfo.decimals);
  if (value <= 0n) throw new Error('Enter an amount greater than zero');

  const fromAta = getAssociatedTokenAddressSync(mint, payer.publicKey, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(mint, recipient, true, programId, ASSOCIATED_TOKEN_PROGRAM_ID);

  const tx = new Transaction();
  const recipientAccount = await connection.getAccountInfo(toAta);
  const createdRecipientAccount = recipientAccount === null;
  if (createdRecipientAccount) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        toAta,
        recipient,
        mint,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  tx.add(
    createTransferCheckedInstruction(
      fromAta,
      mint,
      toAta,
      payer.publicKey,
      value,
      mintInfo.decimals,
      [],
      programId,
    ),
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: 'confirmed',
  });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

  return { signature, createdRecipientAccount };
}

/** Decimal string -> smallest unit, without ever touching a float. */
export function parseTokenAmount(amount: string, decimals: number): bigint {
  const clean = amount.trim().replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(clean) || clean === '' || clean === '.') {
    throw new Error(`"${amount}" is not a valid amount`);
  }
  const [whole = '0', frac = ''] = clean.split('.');
  if (frac.length > decimals) throw new Error(`This token supports at most ${decimals} decimals`);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

export const solanaAdapter: ChainAdapter = {
  meta: SOLANA_META,

  async derive(seed, { accountIndex }: DeriveOptions) {
    const kp = solanaKeypair(seed, accountIndex);
    const account: DerivedAccount = {
      chain: 'solana',
      address: kp.publicKey.toBase58(),
      publicKey: Buffer.from(kp.publicKey.toBytes()).toString('hex'),
      derivationPath: solanaPath(accountIndex),
    };
    return account;
  },

  async getBalance(address, mode): Promise<ChainBalance> {
    const connection = getConnection(mode);
    const [lamports, rent] = await Promise.all([
      connection.getBalance(new PublicKey(address)),
      connection.getMinimumBalanceForRentExemption(0).catch(() => 890_880),
    ]);
    return {
      chain: 'solana',
      raw: BigInt(lamports),
      decimals: 9,
      symbol: 'SOL',
      reservedRaw: BigInt(rent),
      unfunded: lamports === 0,
    };
  },

  async estimateFee(): Promise<FeeQuote> {
    // One signature, no priority fee - the fixed base cost of a simple transfer.
    return {
      raw: 5_000n,
      decimals: 9,
      symbol: 'SOL',
      label: 'Network fee',
      detail: '5000 lamports (1 signature)',
    };
  },

  async send({ seed, mode, accountIndex, to, amount, memo, tokenAddress }: SendParams): Promise<SendResult> {
    if (!this.validateAddress(to, mode)) throw new Error(`"${to}" is not a valid Solana address`);

    if (tokenAddress) {
      const { signature } = await sendSplToken({
        seed,
        accountIndex,
        mode,
        mintAddress: tokenAddress,
        to,
        amount,
      });
      return { hash: signature, explorerUrl: this.explorerTx(signature, mode) };
    }

    const connection = getConnection(mode);
    const payer = solanaKeypair(seed, accountIndex);
    const lamports = solToLamports(amount);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: new PublicKey(to),
        lamports,
      }),
    );

    if (memo) {
      tx.add(
        new TransactionInstruction({
          keys: [],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(memo, 'utf8'),
        }),
      );
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

    return { hash: signature, explorerUrl: this.explorerTx(signature, mode) };
  },

  validateAddress(address) {
    try {
      const key = new PublicKey(address.trim());
      return PublicKey.isOnCurve(key.toBytes());
    } catch {
      return false;
    }
  },

  explorerAddress: (address, mode) =>
    `https://explorer.solana.com/address/${address}${SOLANA[mode].explorerQuery}`,
  explorerTx: (hash, mode) => `https://explorer.solana.com/tx/${hash}${SOLANA[mode].explorerQuery}`,
};
