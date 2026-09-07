'use client';

import { create } from 'zustand';

import { CHAIN_ORDER, getAdapter } from '@/lib/chains';
import type {
  BtcAddressType,
  ChainBalance,
  ChainId,
  DerivedAccount,
  NetworkMode,
} from '@/lib/chains/types';
import { generateMnemonic, mnemonicToSeed, normalizeMnemonic, validateMnemonic } from '@/lib/crypto/mnemonic';
import {
  decryptVault,
  destroyVault,
  encryptVault,
  loadMeta,
  loadVault,
  saveMeta,
  saveVault,
} from '@/lib/crypto/vault';
import { fetchPrices, type PriceMap } from '@/lib/prices';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  persistSettings,
  type DeploymentRecord,
  type Settings,
  type TrackedToken,
} from './settings';

export type WalletStatus = 'booting' | 'no-wallet' | 'locked' | 'unlocked';

interface WalletState {
  status: WalletStatus;
  settings: Settings;
  backedUp: boolean;
  /**
   * True from the moment a phrase is generated until the user has revealed and
   * verified it. The gate stays mounted while this is set, so the reveal and
   * verification steps are not blown away by `status` flipping to 'unlocked'.
   */
  onboarding: boolean;

  /** In-memory only. Never serialised, never leaves this tab. */
  mnemonic: string | null;
  seed: Uint8Array | null;

  accounts: Partial<Record<ChainId, DerivedAccount>>;
  balances: Partial<Record<ChainId, ChainBalance>>;
  balanceErrors: Partial<Record<ChainId, string>>;
  refreshing: boolean;
  prices: PriceMap;

  lastActivity: number;

  boot: () => void;
  createWallet: (words: 12 | 24, password: string) => Promise<string>;
  importWallet: (phrase: string, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  wipe: () => void;
  confirmBackup: () => void;
  touch: () => void;

  setMode: (mode: NetworkMode) => Promise<void>;
  setAccountIndex: (index: number) => Promise<void>;
  setBtcAddressType: (type: BtcAddressType) => Promise<void>;
  patchSettings: (patch: Partial<Settings>) => void;

  deriveAccounts: () => Promise<void>;
  refreshBalances: () => Promise<void>;

  addTrackedToken: (token: TrackedToken) => void;
  removeTrackedToken: (address: string, mode: NetworkMode) => void;
  recordDeployment: (record: DeploymentRecord) => void;
}

/** Overwrite key material before dropping the reference. */
function zero(bytes: Uint8Array | null): void {
  if (bytes) bytes.fill(0);
}

export const useWallet = create<WalletState>((set, get) => ({
  status: 'booting',
  settings: DEFAULT_SETTINGS,
  backedUp: false,
  onboarding: false,
  mnemonic: null,
  seed: null,
  accounts: {},
  balances: {},
  balanceErrors: {},
  refreshing: false,
  prices: {},
  lastActivity: Date.now(),

  boot: () => {
    const settings = loadSettings();
    const meta = loadMeta();
    set({
      settings,
      backedUp: meta.backedUp,
      status: loadVault() ? 'locked' : 'no-wallet',
    });
    void fetchPrices().then((prices) => set({ prices }));
  },

  createWallet: async (words, password) => {
    const phrase = generateMnemonic(words === 24 ? 256 : 128);
    const vault = await encryptVault(phrase, password);
    saveVault(vault);
    saveMeta({ backedUp: false, createdAt: Date.now() });

    set({
      mnemonic: phrase,
      seed: mnemonicToSeed(phrase),
      status: 'unlocked',
      backedUp: false,
      onboarding: true,
    });
    await get().deriveAccounts();
    return phrase;
  },

  importWallet: async (phrase, password) => {
    const normalized = normalizeMnemonic(phrase);
    if (!validateMnemonic(normalized)) {
      throw new Error('That is not a valid BIP-39 phrase - check the spelling and word order');
    }
    const vault = await encryptVault(normalized, password);
    saveVault(vault);
    // An imported phrase is by definition already backed up somewhere.
    saveMeta({ backedUp: true, createdAt: Date.now() });

    set({
      mnemonic: normalized,
      seed: mnemonicToSeed(normalized),
      status: 'unlocked',
      backedUp: true,
      onboarding: false,
    });
    await get().deriveAccounts();
  },

  unlock: async (password) => {
    const vault = loadVault();
    if (!vault) throw new Error('No wallet found on this device');
    const phrase = await decryptVault(vault, password);

    set({
      mnemonic: phrase,
      seed: mnemonicToSeed(phrase),
      status: 'unlocked',
      backedUp: loadMeta().backedUp,
      lastActivity: Date.now(),
    });
    await get().deriveAccounts();
    void get().refreshBalances();
  },

  lock: () => {
    zero(get().seed);
    set({
      status: loadVault() ? 'locked' : 'no-wallet',
      mnemonic: null,
      seed: null,
      accounts: {},
      balances: {},
      balanceErrors: {},
      onboarding: false,
    });
  },

  wipe: () => {
    zero(get().seed);
    destroyVault();
    set({
      status: 'no-wallet',
      mnemonic: null,
      seed: null,
      accounts: {},
      balances: {},
      balanceErrors: {},
      backedUp: false,
      onboarding: false,
    });
  },

  confirmBackup: () => {
    saveMeta({ backedUp: true });
    set({ backedUp: true, onboarding: false });
  },

  touch: () => set({ lastActivity: Date.now() }),

  patchSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    persistSettings(settings);
    set({ settings });
  },

  setMode: async (mode) => {
    get().patchSettings({ mode });
    set({ balances: {}, balanceErrors: {} });
    await get().deriveAccounts();
    void get().refreshBalances();
  },

  setAccountIndex: async (accountIndex) => {
    get().patchSettings({ accountIndex });
    set({ balances: {}, balanceErrors: {} });
    await get().deriveAccounts();
    void get().refreshBalances();
  },

  setBtcAddressType: async (btcAddressType) => {
    get().patchSettings({ btcAddressType });
    await get().deriveAccounts();
    void get().refreshBalances();
  },

  deriveAccounts: async () => {
    const { seed, settings } = get();
    if (!seed) return;

    const entries = await Promise.all(
      CHAIN_ORDER.map(async (chain) => {
        try {
          const adapter = await getAdapter(chain);
          const account = await adapter.derive(seed, {
            accountIndex: settings.accountIndex,
            mode: settings.mode,
            btcAddressType: settings.btcAddressType,
          });
          return [chain, account] as const;
        } catch (err) {
          console.error(`Derivation failed for ${chain}`, err);
          return [chain, undefined] as const;
        }
      }),
    );

    const accounts: Partial<Record<ChainId, DerivedAccount>> = {};
    for (const [chain, account] of entries) if (account) accounts[chain] = account;
    set({ accounts });
  },

  refreshBalances: async () => {
    const { accounts, settings } = get();
    if (Object.keys(accounts).length === 0) return;

    set({ refreshing: true, balanceErrors: {} });
    void fetchPrices().then((prices) => set({ prices }));

    // Every chain is queried independently: one dead RPC must not blank the
    // whole portfolio.
    await Promise.all(
      CHAIN_ORDER.map(async (chain) => {
        const account = accounts[chain];
        if (!account) return;
        try {
          const adapter = await getAdapter(chain);
          const balance = await adapter.getBalance(account.address, settings.mode);
          set((s) => ({ balances: { ...s.balances, [chain]: balance } }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set((s) => ({ balanceErrors: { ...s.balanceErrors, [chain]: message } }));
        }
      }),
    );

    set({ refreshing: false });
  },

  addTrackedToken: (token) => {
    const existing = get().settings.trackedTokens;
    const dup = existing.some(
      (t) => t.address.toLowerCase() === token.address.toLowerCase() && t.mode === token.mode,
    );
    if (dup) return;
    get().patchSettings({ trackedTokens: [...existing, token] });
  },

  removeTrackedToken: (address, mode) => {
    get().patchSettings({
      trackedTokens: get().settings.trackedTokens.filter(
        (t) => !(t.address.toLowerCase() === address.toLowerCase() && t.mode === mode),
      ),
    });
  },

  recordDeployment: (record) => {
    get().patchSettings({ deployments: [record, ...get().settings.deployments].slice(0, 50) });
  },
}));

/** Convenience selector: the seed, or a hard error if the wallet is locked. */
export function requireSeed(): Uint8Array {
  const seed = useWallet.getState().seed;
  if (!seed) throw new Error('Wallet is locked');
  return seed;
}
