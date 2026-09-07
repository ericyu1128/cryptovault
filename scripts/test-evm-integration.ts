/**
 * End-to-end test of the EVM paths against a local chain.
 *
 *   node chain.mjs &                 # or any JSON-RPC node on :8545
 *   NEXT_PUBLIC_RPC_SEPOLIA=http://127.0.0.1:8545 npm run test:evm
 *
 * Exercises the real application code - the same modules the browser loads -
 * for: native transfer, ERC-20 deployment, ERC-20 transfer, and the ownable
 * mint / finishMinting lifecycle.
 */
import { Contract, ContractFactory, JsonRpcProvider, formatEther, parseEther } from 'ethers';

import {
  ERC20_MIN_ABI,
  ERC20_WRITE_ABI,
  ensureAllowance,
  evmAdapter,
  evmWallet,
  getProvider,
} from '@/lib/chains/evm';
import { deployErc20, quoteDeployment } from '@/lib/contracts/deploy';
import { ERC20_ABI } from '@/lib/contracts/erc20';
import { mnemonicToSeed } from '@/lib/crypto/mnemonic';
import { formatUnits } from '@/lib/format';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SEED = mnemonicToSeed(MNEMONIC);
const MODE = 'testnet' as const;

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

function assert(name: string, condition: boolean): void {
  check(name, condition, true);
}

const provider: JsonRpcProvider = getProvider(MODE);
const net = await provider.getNetwork();
console.log(`\nConnected to chainId ${net.chainId} at ${process.env.NEXT_PUBLIC_RPC_SEPOLIA}`);

/* ------------------------------------------------------- native transfer */
console.log('\nNative ETH transfer');
{
  const from = await evmAdapter.derive(SEED, { accountIndex: 0, mode: MODE });
  const to = await evmAdapter.derive(SEED, { accountIndex: 1, mode: MODE });
  check('sender is the canonical test address', from.address, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');

  const before = await evmAdapter.getBalance(to.address, MODE);
  const result = await evmAdapter.send({
    seed: SEED,
    mode: MODE,
    accountIndex: 0,
    to: to.address,
    amount: '1.5',
  });
  assert('returned a transaction hash', /^0x[0-9a-f]{64}$/i.test(result.hash));

  await provider.waitForTransaction(result.hash, 1);
  const after = await evmAdapter.getBalance(to.address, MODE);
  check('recipient received exactly 1.5 ETH', after.raw - before.raw, parseEther('1.5'));

  const fee = await evmAdapter.estimateFee({ mode: MODE, accountIndex: 0, to: to.address, amount: '1' });
  assert('fee quote is positive', fee.raw > 0n);
}

/* ------------------------------------------------------- deploy ERC-20 */
console.log('\nERC-20 deployment');
let tokenAddress = '';
{
  const params = {
    seed: SEED,
    accountIndex: 0,
    mode: MODE,
    name: 'Vault Reward Token',
    symbol: 'VRT',
    decimals: 18,
    totalSupply: '1000000',
  };

  const quote = await quoteDeployment(params);
  assert('gas estimate is plausible', quote.gasLimit > 500_000n && quote.gasLimit < 5_000_000n);
  assert('deployer can afford it', quote.sufficient);
  console.log(`       gas ${quote.gasLimit} · cost ${formatEther(quote.costWei)} ETH`);

  const result = await deployErc20(params);
  tokenAddress = result.contractAddress;
  assert('contract address returned', /^0x[0-9a-fA-F]{40}$/.test(result.contractAddress));
  assert('deployment was mined', result.blockNumber !== null);
  console.log(`       deployed at ${result.contractAddress}`);

  const token = new Contract(result.contractAddress, ERC20_ABI, provider);
  const owner = (await evmAdapter.derive(SEED, { accountIndex: 0, mode: MODE })).address;

  check('name', await token.name(), 'Vault Reward Token');
  check('symbol', await token.symbol(), 'VRT');
  check('decimals', await token.decimals(), 18n);
  check('total supply', await token.totalSupply(), 1_000_000n * 10n ** 18n);
  check('owner holds the whole supply', await token.balanceOf(owner), 1_000_000n * 10n ** 18n);
  check('owner is the deployer', await token.owner(), owner);
  check('minting is still open', await token.mintingFinished(), false);
  assert('EIP-2612 permit is present', typeof (await token.DOMAIN_SEPARATOR()) === 'string');

  // Non-18 decimals must scale correctly - this is where a bad token usually breaks.
  const six = await deployErc20({ ...params, name: 'Six Decimals', symbol: 'SIX', decimals: 6, totalSupply: '250' });
  const sixToken = new Contract(six.contractAddress, ERC20_ABI, provider);
  check('6-decimal token decimals', await sixToken.decimals(), 6n);
  check('6-decimal supply scales by 10^6', await sixToken.totalSupply(), 250_000_000n);
}

/* ------------------------------------------------------- ERC-20 transfer */
console.log('\nERC-20 transfer through the send adapter');
{
  const to = await evmAdapter.derive(SEED, { accountIndex: 2, mode: MODE });
  const result = await evmAdapter.send({
    seed: SEED,
    mode: MODE,
    accountIndex: 0,
    to: to.address,
    amount: '1234.5',
    tokenAddress,
  });
  await provider.waitForTransaction(result.hash, 1);

  const token = new Contract(tokenAddress, ERC20_ABI, provider);
  const balance = (await token.balanceOf(to.address)) as bigint;
  check('recipient token balance', formatUnits(balance, 18), '1,234.5');
}

/* ------------------------------------------------- mint / finishMinting */
console.log('\nOwnable mint lifecycle');
{
  const wallet = evmWallet(SEED, 0, MODE);
  const token = new Contract(tokenAddress, ERC20_ABI, wallet);
  const before = (await token.totalSupply()) as bigint;

  await (await token.mint(wallet.address, 10n ** 18n)).wait();
  check('mint increases supply by 1 token', ((await token.totalSupply()) as bigint) - before, 10n ** 18n);

  await (await token.finishMinting()).wait();
  check('mintingFinished flips', await token.mintingFinished(), true);

  let reverted = false;
  try {
    await (await token.mint(wallet.address, 1n)).wait();
  } catch {
    reverted = true;
  }
  assert('minting after finishMinting reverts', reverted);

  // Anyone can burn their own tokens - but account #2 needs gas money first.
  const holder = evmWallet(SEED, 2, MODE);
  await (await wallet.sendTransaction({ to: holder.address, value: parseEther('1') })).wait();
  const held = (await token.balanceOf(holder.address)) as bigint;
  await (await new Contract(tokenAddress, ERC20_ABI, holder).burn(10n ** 18n)).wait();
  check('burn reduces the holder balance', (await token.balanceOf(holder.address)) as bigint, held - 10n ** 18n);
}

/* --------------------------------------------------------- input guards */
console.log('\nDeployment input validation');
{
  const base = { seed: SEED, accountIndex: 0, mode: MODE, name: 'X', symbol: 'XX', decimals: 18, totalSupply: '1' };
  const rejects = async (label: string, patch: Record<string, unknown>) => {
    let threw = false;
    try {
      await quoteDeployment({ ...base, ...patch } as typeof base);
    } catch {
      threw = true;
    }
    assert(label, threw);
  };

  await rejects('empty name is rejected', { name: '  ' });
  await rejects('symbol with a space is rejected', { symbol: 'BAD SYM' });
  await rejects('decimals > 18 is rejected', { decimals: 24 });
  await rejects('fractional supply is rejected', { totalSupply: '1.5' });
  await rejects('bad owner address is rejected', { owner: '0x123' });
}


/* ------------------------------------- non-standard (USDT-like) ERC-20 */
console.log('\nNon-standard token handling (USDT-style ABI and approve rules)');
{
  const { createRequire } = await import('node:module');
  const { readFileSync } = await import('node:fs');
  const require2 = createRequire(import.meta.url);
  const solc = require2('solc');

  const SOURCE = 'MockNonStandardToken.sol';
  const input = {
    language: 'Solidity',
    sources: { [SOURCE]: { content: readFileSync(new URL(`../contracts/mocks/${SOURCE}`, import.meta.url), 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors ?? []).filter((e: { severity: string }) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e: { formattedMessage: string }) => e.formattedMessage).join('\n'));

  const artifact = out.contracts[SOURCE].MockNonStandardToken;
  const wallet = evmWallet(SEED, 0, MODE);
  const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object, wallet);

  const token = await factory.deploy(1_000_000_000n); // 1000 tokens at 6dp
  await token.deploymentTransaction()!.wait(1);
  const tokenAddress = await token.getAddress();
  console.log(`       mock deployed at ${tokenAddress}`);

  const spender = (await evmAdapter.derive(SEED, { accountIndex: 3, mode: MODE })).address;
  const reader = new Contract(tokenAddress, ERC20_MIN_ABI, provider);

  check('decimals read from chain', await reader.decimals(), 6n);
  check('starting allowance is zero', await reader.allowance(wallet.address, spender), 0n);

  // First approval: allowance is 0, so a single transaction is enough.
  const first = await ensureAllowance({
    seed: SEED,
    accountIndex: 0,
    chain: 'ethereum',
    mode: MODE,
    tokenAddress,
    spender,
    amount: 100_000_000n,
  });
  check('fresh approve takes one transaction', first.length, 1);
  check('allowance is set', await reader.allowance(wallet.address, spender), 100_000_000n);

  // The trap: raising a non-zero allowance directly reverts on this token.
  let directRevert = false;
  try {
    const naive = new Contract(tokenAddress, ERC20_WRITE_ABI, wallet);
    await (await naive.approve(spender, 500_000_000n)).wait(1);
  } catch {
    directRevert = true;
  }
  assert('a naive re-approve does revert (the bug we are guarding against)', directRevert);

  // ensureAllowance must recover: reset to zero, then approve.
  const second = await ensureAllowance({
    seed: SEED,
    accountIndex: 0,
    chain: 'ethereum',
    mode: MODE,
    tokenAddress,
    spender,
    amount: 500_000_000n,
  });
  check('raising an allowance takes two transactions', second.length, 2);
  check('allowance was raised successfully', await reader.allowance(wallet.address, spender), 500_000_000n);

  // An already-sufficient allowance should cost nothing.
  const third = await ensureAllowance({
    seed: SEED,
    accountIndex: 0,
    chain: 'ethereum',
    mode: MODE,
    tokenAddress,
    spender,
    amount: 400_000_000n,
  });
  check('sufficient allowance sends no transaction', third.length, 0);

  // A transfer with no bool return must still work through the write ABI.
  const recipient = (await evmAdapter.derive(SEED, { accountIndex: 4, mode: MODE })).address;
  const result = await evmAdapter.send({
    seed: SEED,
    mode: MODE,
    accountIndex: 0,
    to: recipient,
    amount: '12.5',
    tokenAddress,
  });
  await provider.waitForTransaction(result.hash, 1);
  check('transfer without a bool return succeeds', await reader.balanceOf(recipient), 12_500_000n);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
