import '@/lib/polyfills';

import { ContractFactory, formatEther, isAddress, parseUnits } from 'ethers';

import { EVM } from '@/lib/chains/networks';
import { evmWallet, getProvider } from '@/lib/chains/evm';
import type { NetworkMode } from '@/lib/chains/types';
import { ERC20_ABI, ERC20_BYTECODE, ERC20_COMPILER_VERSION } from './erc20';

export interface DeployTokenParams {
  seed: Uint8Array;
  accountIndex: number;
  mode: NetworkMode;
  name: string;
  symbol: string;
  decimals: number;
  /** Whole tokens, e.g. "1000000". The contract scales by `decimals`. */
  totalSupply: string;
  /** Defaults to the deploying account. */
  owner?: string;
}

export interface DeployQuote {
  gasLimit: bigint;
  gasPriceWei: bigint;
  costWei: bigint;
  costEth: string;
  balanceWei: bigint;
  sufficient: boolean;
}

export interface DeployResult {
  contractAddress: string;
  txHash: string;
  explorerTx: string;
  explorerAddress: string;
  blockNumber: number | null;
}

export { ERC20_ABI, ERC20_BYTECODE, ERC20_COMPILER_VERSION };

function validate(params: DeployTokenParams): void {
  const name = params.name.trim();
  const symbol = params.symbol.trim();

  if (name.length === 0 || name.length > 64) throw new Error('Token name must be 1-64 characters');
  if (!/^[A-Za-z0-9]{2,11}$/.test(symbol)) {
    throw new Error('Symbol must be 2-11 letters or digits, no spaces');
  }
  if (!Number.isInteger(params.decimals) || params.decimals < 0 || params.decimals > 18) {
    throw new Error('Decimals must be a whole number between 0 and 18');
  }
  if (!/^\d+$/.test(params.totalSupply.replace(/[,_\s]/g, ''))) {
    throw new Error('Total supply must be a whole number of tokens');
  }
  if (params.owner && !isAddress(params.owner)) throw new Error('Owner is not a valid address');
}

function supplyToBigInt(totalSupply: string): bigint {
  const clean = totalSupply.replace(/[,_\s]/g, '');
  const value = BigInt(clean);
  // The contract multiplies by 10**decimals; keep the product inside uint256.
  if (value > 10n ** 40n) throw new Error('Total supply is unreasonably large');
  return value;
}

/**
 * Price the deployment before asking the user to commit. This does a real
 * `eth_estimateGas` against the encoded constructor, so it catches reverts
 * (bad arguments) as well as giving an accurate cost.
 */
export async function quoteDeployment(params: DeployTokenParams): Promise<DeployQuote> {
  validate(params);
  const wallet = evmWallet(params.seed, params.accountIndex, params.mode);
  const provider = getProvider(params.mode);

  const factory = new ContractFactory(ERC20_ABI, ERC20_BYTECODE, wallet);
  const owner = params.owner?.trim() || wallet.address;

  const tx = await factory.getDeployTransaction(
    params.name.trim(),
    params.symbol.trim().toUpperCase(),
    params.decimals,
    supplyToBigInt(params.totalSupply),
    owner,
  );

  const [gasLimit, feeData, balanceWei] = await Promise.all([
    provider.estimateGas({ ...tx, from: wallet.address }),
    provider.getFeeData(),
    provider.getBalance(wallet.address),
  ]);

  const gasPriceWei = feeData.maxFeePerGas ?? feeData.gasPrice ?? parseUnits('2', 'gwei');
  // 20% headroom: base fee can rise between the quote and the send.
  const paddedGas = (gasLimit * 120n) / 100n;
  const costWei = paddedGas * gasPriceWei;

  return {
    gasLimit: paddedGas,
    gasPriceWei,
    costWei,
    costEth: formatEther(costWei),
    balanceWei,
    sufficient: balanceWei >= costWei,
  };
}

export async function deployErc20(params: DeployTokenParams): Promise<DeployResult> {
  validate(params);

  const wallet = evmWallet(params.seed, params.accountIndex, params.mode);
  const owner = params.owner?.trim() || wallet.address;
  const factory = new ContractFactory(ERC20_ABI, ERC20_BYTECODE, wallet);

  const contract = await factory.deploy(
    params.name.trim(),
    params.symbol.trim().toUpperCase(),
    params.decimals,
    supplyToBigInt(params.totalSupply),
    owner,
  );

  const deployTx = contract.deploymentTransaction();
  if (!deployTx) throw new Error('Deployment transaction was not created');

  const receipt = await deployTx.wait(1);
  const contractAddress = await contract.getAddress();
  const explorer = EVM[params.mode].explorer;

  return {
    contractAddress,
    txHash: deployTx.hash,
    explorerTx: `${explorer}/tx/${deployTx.hash}`,
    explorerAddress: `${explorer}/token/${contractAddress}`,
    blockNumber: receipt?.blockNumber ?? null,
  };
}
