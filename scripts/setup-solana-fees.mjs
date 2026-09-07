#!/usr/bin/env node
/**
 * Creates the associated token accounts that Jupiter pays platform fees into.
 *
 * Jupiter's `feeAccount` must be an existing SPL associated token account for
 * the mint being earned in - a bare wallet address is rejected, and a missing
 * account makes the swap transaction fail outright. CryptoVault degrades to a
 * 0% fee when the account is absent, so run this once to start earning.
 *
 *   SOLANA_FEE_PAYER=~/.config/solana/id.json npm run setup:solana-fees
 *
 * The payer funds roughly 0.002 SOL of rent per account and needs no authority
 * over the fee owner - anyone can create someone else's ATA.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Transaction, sendAndConfirmTransaction } from '@solana/web3.js';

// Keep in sync with src/lib/swap/fees.ts
const FEE_OWNER = 'CryVfG5uS6HmKquiecp9VCvo9zRk9bshFsGEfVcUc2iE';

// Mainnet mints CryptoVault can earn fees in. Must match src/lib/chains/tokens.ts.
const MINTS = [
  { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' },
  { symbol: 'wSOL', mint: 'So11111111111111111111111111111111111111112' },
];

const RPC = process.env.NEXT_PUBLIC_RPC_SOLANA ?? 'https://api.mainnet-beta.solana.com';
const payerPath = (process.env.SOLANA_FEE_PAYER ?? '~/.config/solana/id.json').replace(/^~/, homedir());

function loadPayer() {
  try {
    const secret = JSON.parse(readFileSync(payerPath, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  } catch (err) {
    console.error(`Could not read a keypair from ${payerPath}`);
    console.error('Set SOLANA_FEE_PAYER to a Solana CLI keypair JSON file.');
    console.error(String(err));
    process.exit(1);
  }
}

const connection = new Connection(RPC, 'confirmed');
const payer = loadPayer();
const owner = new PublicKey(FEE_OWNER);

console.log(`RPC       ${RPC}`);
console.log(`payer     ${payer.publicKey.toBase58()}`);
console.log(`fee owner ${owner.toBase58()}\n`);

const balance = await connection.getBalance(payer.publicKey);
console.log(`payer balance: ${(balance / 1e9).toFixed(4)} SOL\n`);

const missing = [];
for (const { symbol, mint } of MINTS) {
  const ata = getAssociatedTokenAddressSync(new PublicKey(mint), owner, true);
  const info = await connection.getAccountInfo(ata);
  console.log(`${symbol.padEnd(5)} ${ata.toBase58()}  ${info ? 'exists' : 'MISSING'}`);
  if (!info) missing.push({ symbol, mint, ata });
}

if (missing.length === 0) {
  console.log('\nAll fee accounts already exist. Nothing to do.');
  process.exit(0);
}

if (process.argv.includes('--dry-run')) {
  console.log(`\n${missing.length} account(s) would be created. Re-run without --dry-run.`);
  process.exit(0);
}

const tx = new Transaction();
for (const { mint, ata } of missing) {
  tx.add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      owner,
      new PublicKey(mint),
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );
}

console.log(`\nCreating ${missing.length} account(s)…`);
const signature = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
console.log(`done: https://explorer.solana.com/tx/${signature}`);
