/**
 * Correctness tests for the parts of CryptoVault where a bug silently loses
 * money: HD derivation, address encoding and amount parsing.
 *
 *   npm run test:derivation
 *
 * Every expected value below is an official published test vector, not
 * something this codebase produced.
 */
import { hex } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { Keypair } from '@solana/web3.js';
import { Wallet } from 'xrpl';

import { slip10DeriveEd25519 } from '@/lib/crypto/slip10';
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '@/lib/crypto/mnemonic';
import { formatUnits, parseUnits } from '@/lib/format';
import { bitcoinAdapter, btcPath } from '@/lib/chains/bitcoin';
import { evmAdapter, evmPath } from '@/lib/chains/evm';
import { solanaAdapter, solanaKeypair, solanaPath } from '@/lib/chains/solana';
import { xrpAdapter, xrpPath, xrpWallet } from '@/lib/chains/xrp';
import { tonAdapter, tonKeyPair, tonPath } from '@/lib/chains/ton';

/* --------------------------------------------------------------- harness */

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = String(actual) === String(expected);
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name}\n       expected: ${expected}\n       actual:   ${actual}`);
  }
}

function assert(name: string, condition: boolean): void {
  check(name, condition, true);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/* ------------------------------------------------ 1. SLIP-0010 (ed25519) */
// Official SLIP-0010 test vector 1 for the ed25519 curve.
section('SLIP-0010 ed25519 (official test vector 1)');
{
  const seed = hex.decode('000102030405060708090a0b0c0d0e0f');
  const vectors: Array<[string, string]> = [
    ['m', '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7'],
    ["m/0'", '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3'],
    ["m/0'/1'", 'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2'],
    ["m/0'/1'/2'", '92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9'],
    ["m/0'/1'/2'/2'", '30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662'],
    ["m/0'/1'/2'/2'/1000000000'", '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793'],
  ];
  for (const [path, expected] of vectors) {
    check(path, hex.encode(slip10DeriveEd25519(path, seed).key), expected);
  }

  let threw = false;
  try {
    slip10DeriveEd25519("m/44'/501'/0'/0", seed);
  } catch {
    threw = true;
  }
  assert('non-hardened segment is rejected', threw);
}

/* ---------------------------------------------------------- 2. BIP-39 */
section('BIP-39');
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SEED = mnemonicToSeed(MNEMONIC);
{
  // BIP-39 reference vector (Trezor), empty passphrase.
  check(
    'seed for the canonical "abandon…about" phrase',
    hex.encode(SEED).slice(0, 32),
    '5eb00bbddcf069084889a8ab91555681',
  );
  assert('valid phrase passes the checksum', validateMnemonic(MNEMONIC));
  assert(
    'a corrupted phrase fails the checksum',
    !validateMnemonic(MNEMONIC.replace('about', 'abandon')),
  );
  assert('generated 12-word phrase is valid', validateMnemonic(generateMnemonic(128)));
  assert('generated 24-word phrase is valid', validateMnemonic(generateMnemonic(256)));
  check('24-word phrase length', generateMnemonic(256).split(' ').length, 24);
}

/* -------------------------------------------------------- 3. Bitcoin */
section('Bitcoin — BIP-84 / BIP-86 reference vectors');
{
  const opts = { accountIndex: 0, mode: 'mainnet' as const };

  const segwit = await bitcoinAdapter.derive(SEED, { ...opts, btcAddressType: 'segwit' });
  check('BIP-84 path', btcPath('segwit', 'mainnet', 0), "m/84'/0'/0'/0/0");
  check('BIP-84 first receive address', segwit.address, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');

  const taproot = await bitcoinAdapter.derive(SEED, { ...opts, btcAddressType: 'taproot' });
  check('BIP-86 path', btcPath('taproot', 'mainnet', 0), "m/86'/0'/0'/0/0");
  check(
    'BIP-86 first receive address',
    taproot.address,
    'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
  );

  check('segwit exposes taproot as the alternate', segwit.altAddress?.address, taproot.address);

  assert('mainnet address validates on mainnet', bitcoinAdapter.validateAddress(segwit.address, 'mainnet'));
  assert(
    'mainnet address is rejected on testnet',
    !bitcoinAdapter.validateAddress(segwit.address, 'testnet'),
  );
  assert('garbage is rejected', !bitcoinAdapter.validateAddress('not-an-address', 'mainnet'));

  const testnet = await bitcoinAdapter.derive(SEED, { accountIndex: 0, mode: 'testnet', btcAddressType: 'segwit' });
  assert('testnet uses coin type 1', testnet.derivationPath === "m/84'/1'/0'/0/0");
  assert('testnet address is bech32 tb1', testnet.address.startsWith('tb1'));
}

/* ------------------------------------------------------- 4. Ethereum */
section('Ethereum — BIP-44 m/44\'/60\'/0\'/0/0');
{
  const account = await evmAdapter.derive(SEED, { accountIndex: 0, mode: 'mainnet' });
  check('path', evmPath(0), "m/44'/60'/0'/0/0");
  check('first address', account.address, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');

  const second = await evmAdapter.derive(SEED, { accountIndex: 1, mode: 'mainnet' });
  assert('account #1 differs from #0', second.address !== account.address);
  assert('EIP-55 checksum address validates', evmAdapter.validateAddress(account.address, 'mainnet'));
  assert('short hex is rejected', !evmAdapter.validateAddress('0x1234', 'mainnet'));
}

/* --------------------------------------------------------- 5. Solana */
section("Solana — SLIP-0010 m/44'/501'/0'/0'");
{
  const account = await solanaAdapter.derive(SEED, { accountIndex: 0, mode: 'mainnet' });
  check('path', solanaPath(0), "m/44'/501'/0'/0'");

  // Cross-check: the address must be the base58 of the ed25519 public key that
  // Keypair.fromSeed produces from the SLIP-0010 node.
  const { key } = slip10DeriveEd25519(solanaPath(0), SEED);
  check('address matches Keypair.fromSeed(slip10 node)', account.address, Keypair.fromSeed(key).publicKey.toBase58());
  check('public key hex matches the keypair', account.publicKey, Buffer.from(solanaKeypair(SEED, 0).publicKey.toBytes()).toString('hex'));

  assert('derived address validates', solanaAdapter.validateAddress(account.address, 'mainnet'));
  assert('an EVM address is rejected', !solanaAdapter.validateAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94', 'mainnet'));
  assert('accounts are independent', (await solanaAdapter.derive(SEED, { accountIndex: 1, mode: 'mainnet' })).address !== account.address);
}

/* ------------------------------------------------------------ 6. XRP */
section("XRP Ledger — BIP-44 m/44'/144'/0'/0/0");
{
  const account = await xrpAdapter.derive(SEED, { accountIndex: 0, mode: 'mainnet' });
  check('path', xrpPath(0), "m/44'/144'/0'/0/0");

  // The strongest check available: our seed-based derivation must agree with
  // xrpl.js's own Wallet.fromMnemonic bip39 implementation, byte for byte.
  const reference = Wallet.fromMnemonic(MNEMONIC, { mnemonicEncoding: 'bip39' });
  check('address matches xrpl.js Wallet.fromMnemonic', account.address, reference.classicAddress);
  check('public key matches xrpl.js', xrpWallet(SEED, 0).publicKey, reference.publicKey);
  check('private key matches xrpl.js', xrpWallet(SEED, 0).privateKey, reference.privateKey);

  assert('address starts with r', account.address.startsWith('r'));
  assert('derived address validates', xrpAdapter.validateAddress(account.address, 'mainnet'));
  assert('garbage is rejected', !xrpAdapter.validateAddress('rNotARealAddress', 'mainnet'));
}

/* ------------------------------------------------------------ 7. TON */
section("TON — SLIP-0010 m/44'/607'/0' (Trust Wallet convention), Wallet V4R2");
{
  const mainnet = await tonAdapter.derive(SEED, { accountIndex: 0, mode: 'mainnet' });
  const testnet = await tonAdapter.derive(SEED, { accountIndex: 0, mode: 'testnet' });
  check('path', tonPath(0), "m/44'/607'/0'");

  const { key } = slip10DeriveEd25519(tonPath(0), SEED);
  check('keypair seed matches the SLIP-0010 node', tonKeyPair(SEED, 0).secretKey.subarray(0, 32).toString('hex'), hex.encode(key));

  assert('mainnet address is non-bounceable (UQ…)', mainnet.address.startsWith('UQ'));
  assert('testnet address is non-bounceable testnet (0Q…)', testnet.address.startsWith('0Q'));
  assert('same key, different display flags', mainnet.address !== testnet.address);
  assert('derived address validates', tonAdapter.validateAddress(mainnet.address, 'mainnet'));
  assert('garbage is rejected', !tonAdapter.validateAddress('definitely not ton', 'mainnet'));
}

/* --------------------------------------------- 8. Amount math (no float) */
section('Amount parsing and formatting');
{
  check('1 BTC in sats', parseUnits('1', 8), 100000000n);
  check('0.00000001 BTC', parseUnits('0.00000001', 8), 1n);
  check('1 ETH in wei', parseUnits('1', 18), 1000000000000000000n);
  check('0.1 ETH in wei', parseUnits('0.1', 18), 100000000000000000n);
  check('formats wei back', formatUnits(1000000000000000000n, 18), '1');
  check('trims trailing zeros', formatUnits(100000000n, 8), '1');
  check('keeps significant fraction', formatUnits(123456789n, 8), '1.23456789');
  check('caps at 8 fraction digits by default', formatUnits(123456789012345678901n, 18), '123.45678901');
  check('groups thousands', formatUnits(1234567890000000000000n, 18), '1,234.56789');

  let threw = false;
  try {
    parseUnits('0.123456789', 8);
  } catch {
    threw = true;
  }
  assert('rejects more decimals than the chain supports', threw);

  threw = false;
  try {
    parseUnits('abc', 8);
  } catch {
    threw = true;
  }
  assert('rejects non-numeric input', threw);
}

/* ------------------------------------------------------------ summary */
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
