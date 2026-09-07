import type { BtcAddressType, NetworkMode } from '@/lib/chains/types';

const SETTINGS_KEY = 'cryptovault.settings.v1';

export interface TrackedToken {
  address: string;
  mode: NetworkMode;
  symbol: string;
  name: string;
  decimals: number;
}

export interface DeploymentRecord {
  contractAddress: string;
  txHash: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  mode: NetworkMode;
  chainId: number;
  deployedAt: number;
  explorerAddress: string;
}

export interface Settings {
  mode: NetworkMode;
  accountIndex: number;
  btcAddressType: BtcAddressType;
  autoLockMinutes: number;
  hideBalances: boolean;
  trackedTokens: TrackedToken[];
  deployments: DeploymentRecord[];
}

export const DEFAULT_SETTINGS: Settings = {
  // Testnet-first on purpose. Switching to mainnet is a deliberate, confirmed
  // action - see the network switch in the header.
  mode: 'testnet',
  accountIndex: 0,
  btcAddressType: 'segwit',
  autoLockMinutes: 15,
  hideBalances: false,
  trackedTokens: [],
  deployments: [],
};

export function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function persistSettings(settings: Settings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage full or blocked - settings are a convenience, never critical */
  }
}
