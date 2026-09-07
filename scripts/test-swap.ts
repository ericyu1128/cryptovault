/**
 * Tests for the new-coin registry, the BSC adapter and the swap fee router.
 *
 *   npm run test:swap
 *
 * These cover the places where a silent bug moves the wrong amount of money:
 * basis-point arithmetic, token decimals, and which address a fee lands at.
 */
import { getAddress, isAddress } from 'ethers';
import { PublicKey } from '@solana/web3.js';

import { ALL_TOKENS, findToken, tokensFor, wrappedNativeFor } from '@/lib/chains/tokens';
import { bscAdapter, evmAdapter } from '@/lib/chains/evm';
import { EVM_CHAINS } from '@/lib/chains/networks';
import { CHAIN_ORDER, CHAIN_METAS, PLANNED_CHAINS } from '@/lib/chains/meta';
import { moneroAdapter } from '@/lib/chains/monero';
import { mnemonicToSeed } from '@/lib/crypto/mnemonic';
import { parseTokenAmount } from '@/lib/chains/solana';
import {
  DEV_FEE_BPS,
  EVM_FEE_RECIPIENT,
  SOLANA_FEE_OWNER,
  applyBps,
  applySlippage,
  evmFeeTokenPreference,
  feeRecipientFor,
} from '@/lib/swap/fees';
import { providerIdFor, SWAPPABLE_CHAINS } from '@/lib/swap';
import type { SwapAsset } from '@/lib/swap/types';

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  if (String(actual) === String(expected)) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name}\n       expected: ${expected}\n       actual:   ${actual}`);
  }
}
const assert = (name: string, cond: boolean) => check(name, cond, true);
const section = (t: string) => console.log(`\n${t}`);

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SEED = mnemonicToSeed(MNEMONIC);

/* ------------------------------------------------------ 1. fee arithmetic */
section('Fee arithmetic (basis points on bigint)');
{
  check('0.5% is 50 bps', DEV_FEE_BPS, 50);

  // 1000 USDC at 6 decimals -> 5 USDC
  check('0.5% of 1000 USDC', applyBps(1_000_000_000n, 50), 5_000_000n);
  // 1 ETH at 18 decimals -> 0.005 ETH
  check('0.5% of 1 ETH', applyBps(10n ** 18n, 50), 5_000_000_000_000_000n);
  // 1000 USDT on BSC is 18 decimals, not 6 - the fee must scale with it
  check('0.5% of 1000 BSC-USDT (18dp)', applyBps(1000n * 10n ** 18n, 50), 5n * 10n ** 18n);

  check('rounds down, never up', applyBps(199n, 50), 0n);
  check('exactly one unit', applyBps(200n, 50), 1n);
  check('zero stays zero', applyBps(0n, 50), 0n);

  check('0.5% slippage off 1000', applySlippage(1_000_000_000n, 50), 995_000_000n);
  check('3% slippage off 1 ETH', applySlippage(10n ** 18n, 300), 970_000_000_000_000_000n);

  // A huge trade must not overflow or lose precision - this is why it is bigint.
  const whale = 10_000_000n * 10n ** 18n;
  check('0.5% of 10M tokens is exact', applyBps(whale, 50), 50_000n * 10n ** 18n);

  let threw = false;
  try {
    applyBps(100n, 10_001);
  } catch {
    threw = true;
  }
  assert('rejects bps above 100%', threw);

  threw = false;
  try {
    applyBps(100n, -1);
  } catch {
    threw = true;
  }
  assert('rejects negative bps', threw);
}

/* -------------------------------------------------- 2. fee destinations */
section('Fee destinations');
{
  check(
    'EVM recipient is the address supplied',
    EVM_FEE_RECIPIENT,
    '0x2c76D6c28e22f432Cf796a53B49C863d62A488C4',
  );
  assert('EVM recipient is a valid address', isAddress(EVM_FEE_RECIPIENT));
  check(
    'EVM recipient is EIP-55 checksummed',
    getAddress(EVM_FEE_RECIPIENT),
    EVM_FEE_RECIPIENT,
  );

  check('Solana fee owner', SOLANA_FEE_OWNER, 'CryVfG5uS6HmKquiecp9VCvo9zRk9bshFsGEfVcUc2iE');
  assert('Solana fee owner is a valid pubkey', new PublicKey(SOLANA_FEE_OWNER).toBase58() === SOLANA_FEE_OWNER);
  assert(
    'Solana fee owner is a wallet, not a PDA',
    PublicKey.isOnCurve(new PublicKey(SOLANA_FEE_OWNER).toBytes()),
  );

  check('ethereum routes to the EVM address', feeRecipientFor('ethereum'), EVM_FEE_RECIPIENT);
  check('bsc routes to the same EVM address', feeRecipientFor('bsc'), EVM_FEE_RECIPIENT);
  check('solana routes to the Solana owner', feeRecipientFor('solana'), SOLANA_FEE_OWNER);
  check('bitcoin has no fee destination', feeRecipientFor('bitcoin'), null);
}

/* ------------------------------------------- 3. EVM fee-token preference */
section('EVM fee token selection (prefer ETH/WETH)');
{
  const asset = (address: string, symbol: string, native = false): SwapAsset => ({
    chain: 'ethereum',
    mode: 'mainnet',
    address,
    symbol,
    name: symbol,
    decimals: 18,
    native,
  });

  const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
  const weth = wrappedNativeFor('ethereum', 'mainnet')!;
  const usdc = findToken('ethereum', 'mainnet', 'usdc')!;
  const usdt = findToken('ethereum', 'mainnet', 'usdt')!;

  const eth = asset(NATIVE, 'ETH', true);
  const wethAsset = asset(weth.address, 'WETH');
  const usdcAsset = asset(usdc.address, 'USDC');
  const usdtAsset = asset(usdt.address, 'USDT');

  check(
    'USDC -> ETH collects the fee in ETH',
    evmFeeTokenPreference(usdcAsset, eth)[0].symbol,
    'ETH',
  );
  check(
    'ETH -> USDC still collects in ETH (sell leg)',
    evmFeeTokenPreference(eth, usdcAsset)[0].symbol,
    'ETH',
  );
  check(
    'USDC -> WETH collects in WETH',
    evmFeeTokenPreference(usdcAsset, wethAsset)[0].symbol,
    'WETH',
  );
  check(
    'USDC -> USDT has no ETH leg, falls back to the buy token',
    evmFeeTokenPreference(usdcAsset, usdtAsset)[0].symbol,
    'USDT',
  );
  assert(
    'preference list always offers a fallback',
    evmFeeTokenPreference(usdcAsset, usdtAsset).length >= 2,
  );
  assert(
    'preference list has no duplicates',
    new Set(evmFeeTokenPreference(usdcAsset, eth).map((a) => a.address.toLowerCase())).size ===
      evmFeeTokenPreference(usdcAsset, eth).length,
  );
}

/* --------------------------------------------------- 4. token registry */
section('Token registry integrity');
{
  // Addresses verified against Circle, Tether and the PancakeSwap default list.
  check('USDC Ethereum', findToken('ethereum', 'mainnet', 'usdc')?.address, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  check('USDT Ethereum', findToken('ethereum', 'mainnet', 'usdt')?.address, '0xdAC17F958D2ee523a2206206994597C13D831ec7');
  check('USDC Sepolia', findToken('ethereum', 'testnet', 'usdc')?.address, '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
  check('USDT BSC', findToken('bsc', 'mainnet', 'usdt')?.address, '0x55d398326f99059fF775485246999027B3197955');
  check('USDC BSC', findToken('bsc', 'mainnet', 'usdc')?.address, '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d');
  check('USDC Solana', findToken('solana', 'mainnet', 'usdc')?.address, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  check('USDT Solana', findToken('solana', 'mainnet', 'usdt')?.address, 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
  check('USDC Solana devnet', findToken('solana', 'testnet', 'usdc')?.address, '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

  // The decimals trap: same ticker, different scale per chain.
  check('USDC on Ethereum is 6dp', findToken('ethereum', 'mainnet', 'usdc')?.decimals, 6);
  check('USDC on BSC is 18dp', findToken('bsc', 'mainnet', 'usdc')?.decimals, 18);
  check('USDT on Ethereum is 6dp', findToken('ethereum', 'mainnet', 'usdt')?.decimals, 6);
  check('USDT on BSC is 18dp', findToken('bsc', 'mainnet', 'usdt')?.decimals, 18);
  check('USDC on Solana is 6dp', findToken('solana', 'mainnet', 'usdc')?.decimals, 6);

  // USDT's non-standard ABI must be flagged or approvals break.
  const usdtEth = findToken('ethereum', 'mainnet', 'usdt')!;
  assert('USDT Ethereum flags no-bool-return', usdtEth.quirks?.includes('no-bool-return') === true);
  assert('USDT Ethereum flags zero-before-approve', usdtEth.quirks?.includes('zero-before-approve') === true);

  assert('BSC stablecoins are marked bridged', findToken('bsc', 'mainnet', 'usdt')?.bridged === true);
  assert('Ethereum USDC is not marked bridged', !findToken('ethereum', 'mainnet', 'usdc')?.bridged);

  for (const t of ALL_TOKENS) {
    const label = `${t.chain}/${t.mode}/${t.symbol}`;
    if (t.chain === 'solana') {
      assert(`${label} is a valid SPL mint`, new PublicKey(t.address).toBase58() === t.address);
    } else {
      assert(`${label} is EIP-55 checksummed`, isAddress(t.address) && getAddress(t.address) === t.address);
    }
    assert(`${label} has sane decimals`, Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 18);
  }

  const keys = ALL_TOKENS.map((t) => `${t.chain}:${t.mode}:${t.key}`);
  check('no duplicate registry entries', new Set(keys).size, keys.length);

  assert('no USDT is listed on Sepolia', findToken('ethereum', 'testnet', 'usdt') === undefined);
  check('BSC testnet lists no stablecoins', tokensFor('bsc', 'testnet').length, 0);
}

/* --------------------------------------------------------- 5. BSC chain */
section('BNB Smart Chain adapter');
{
  const eth = await evmAdapter.derive(SEED, { accountIndex: 0, mode: 'mainnet' });
  const bsc = await bscAdapter.derive(SEED, { accountIndex: 0, mode: 'mainnet' });

  check('BSC reuses the Ethereum address', bsc.address, eth.address);
  check('address is the canonical test vector', bsc.address, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
  check('same derivation path', bsc.derivationPath, "m/44'/60'/0'/0/0");
  check('chain id on the account', bsc.chain, 'bsc');

  check('BSC mainnet chainId', EVM_CHAINS.bsc.mainnet.chainId, 56);
  check('BSC testnet chainId', EVM_CHAINS.bsc.testnet.chainId, 97);
  check('BSC native symbol', EVM_CHAINS.bsc.mainnet.symbol, 'BNB');
  check('BSC testnet native symbol', EVM_CHAINS.bsc.testnet.symbol, 'tBNB');
  check('BNB metadata decimals', CHAIN_METAS.bsc.decimals, 18);

  assert('BSC explorer points at bscscan', bscAdapter.explorerTx('0xabc', 'mainnet').startsWith('https://bscscan.com/tx/'));
  assert('BSC testnet explorer is separate', bscAdapter.explorerTx('0xabc', 'testnet').includes('testnet.bscscan.com'));
  assert('BSC validates EVM addresses', bscAdapter.validateAddress(eth.address, 'mainnet'));
}

/* ------------------------------------------------- 6. provider routing */
section('Swap provider routing');
{
  check('ethereum mainnet uses 0x', providerIdFor('ethereum', 'mainnet'), '0x');
  check('bsc mainnet uses 0x', providerIdFor('bsc', 'mainnet'), '0x');
  check('solana mainnet uses jupiter', providerIdFor('solana', 'mainnet'), 'jupiter');
  check('sepolia has no provider', providerIdFor('ethereum', 'testnet'), null);
  check('solana devnet has no provider', providerIdFor('solana', 'testnet'), null);
  check('bitcoin has no provider', providerIdFor('bitcoin', 'mainnet'), null);
  check('ton has no provider', providerIdFor('ton', 'mainnet'), null);
  check('swappable chain count', SWAPPABLE_CHAINS.length, 3);
}

/* ------------------------------------------------------- 7. Monero stub */
section('Monero stub');
{
  assert('monero is registered in metadata', CHAIN_METAS.monero.symbol === 'XMR');
  assert('monero is NOT in CHAIN_ORDER', !CHAIN_ORDER.includes('monero'));
  assert('monero is listed as planned', PLANNED_CHAINS.includes('monero'));
  check('XMR has 12 decimals (atomic units)', CHAIN_METAS.monero.decimals, 12);

  let threw = false;
  try {
    await moneroAdapter.derive(SEED, { accountIndex: 0, mode: 'mainnet' });
  } catch (err) {
    threw = err instanceof Error && err.message.includes('not implemented');
  }
  assert('derive throws an explicit not-implemented error', threw);
  assert('validateAddress rejects everything', !moneroAdapter.validateAddress('4AdUnd…', 'mainnet'));
}

/* ------------------------------------------------- 8. SPL amount parsing */
section('SPL amount parsing');
{
  check('1 USDC at 6dp', parseTokenAmount('1', 6), 1_000_000n);
  check('0.000001 USDC', parseTokenAmount('0.000001', 6), 1n);
  check('1 BSC-USDT at 18dp', parseTokenAmount('1', 18), 10n ** 18n);
  check('trailing zeros are fine', parseTokenAmount('1.500000', 6), 1_500_000n);

  let threw = false;
  try {
    parseTokenAmount('0.0000001', 6);
  } catch {
    threw = true;
  }
  assert('rejects more precision than the mint allows', threw);

  threw = false;
  try {
    parseTokenAmount('1e6', 6);
  } catch {
    threw = true;
  }
  assert('rejects scientific notation', threw);
}

/* ----------------------------------------------------- 9. chain ordering */
section('Chain wiring');
{
  check('portfolio renders six chains', CHAIN_ORDER.length, 6);
  assert('bsc appears in the portfolio', CHAIN_ORDER.includes('bsc'));
  for (const chain of CHAIN_ORDER) {
    assert(`${chain} has metadata`, Boolean(CHAIN_METAS[chain]?.symbol));
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
