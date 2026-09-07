'use client';

import * as React from 'react';

import { CHAIN_METAS, CHAIN_ORDER } from '@/lib/chains/meta';
import { classNames } from '@/lib/format';
import { useToasts } from '@/state/toastStore';
import { useWallet } from '@/state/walletStore';
import DeployTab from './tabs/DeployTab';
import PortfolioTab from './tabs/PortfolioTab';
import SendTab from './tabs/SendTab';
import SwapTab from './tabs/SwapTab';
import SettingsTab from './tabs/SettingsTab';
import { Alert, Badge, Button, Modal } from './ui';

const TABS = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'send', label: 'Send' },
  { id: 'swap', label: 'Swap' },
  { id: 'deploy', label: 'Token Deployer' },
  { id: 'settings', label: 'Settings' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Dashboard() {
  const [tab, setTab] = React.useState<TabId>('portfolio');
  const backedUp = useWallet((s) => s.backedUp);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-24 sm:px-6 sm:pt-6">
      <Header />

      {!backedUp && <BackupWarning />}

      <nav className="mt-6 flex gap-1 overflow-x-auto rounded-xl border border-edge bg-panel p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={classNames(
              'flex-1 rounded-lg px-2.5 py-2 text-xs font-medium whitespace-nowrap transition-colors sm:px-4 sm:text-sm',
              tab === t.id ? 'bg-panel-2 text-slate-50 shadow-sm' : 'text-muted hover:text-slate-200',
            )}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-5">
        {tab === 'portfolio' && <PortfolioTab />}
        {tab === 'send' && <SendTab />}
        {tab === 'swap' && <SwapTab />}
        {tab === 'deploy' && <DeployTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

function Header() {
  const mode = useWallet((s) => s.settings.mode);
  const accountIndex = useWallet((s) => s.settings.accountIndex);
  const setMode = useWallet((s) => s.setMode);
  const setAccountIndex = useWallet((s) => s.setAccountIndex);
  const lock = useWallet((s) => s.lock);
  const push = useToasts((s) => s.push);

  const [confirmMainnet, setConfirmMainnet] = React.useState(false);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-xl border border-edge bg-panel">
          <svg viewBox="0 0 24 24" className="size-5 text-mint" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M12 2.5 4 6v6c0 4.6 3.3 8.3 8 9.5 4.7-1.2 8-4.9 8-9.5V6l-8-3.5Z" strokeLinejoin="round" />
            <path d="M9.5 12.2 11.3 14l3.4-3.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight text-slate-50">CryptoVault</p>
          <p className="text-[11px] text-dim">
            {/* CHAIN_ORDER, not every registered meta - Monero is a stub. */}
            {CHAIN_ORDER.map((id) => CHAIN_METAS[id].symbol).join(' · ')}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-edge bg-panel p-0.5">
          <button
            onClick={() => void setMode('testnet')}
            className={classNames(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              mode === 'testnet' ? 'bg-mint/15 text-mint' : 'text-muted hover:text-slate-200',
            )}
          >
            Testnet
          </button>
          <button
            onClick={() => (mode === 'mainnet' ? undefined : setConfirmMainnet(true))}
            className={classNames(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              mode === 'mainnet' ? 'bg-amber/15 text-amber' : 'text-muted hover:text-slate-200',
            )}
          >
            Mainnet
          </button>
        </div>

        <label className="flex items-center gap-1.5 rounded-lg border border-edge bg-panel px-2.5 py-1.5 text-xs text-muted">
          <span className="text-dim">Account</span>
          <select
            value={accountIndex}
            onChange={(e) => void setAccountIndex(Number(e.target.value))}
            className="bg-transparent text-slate-100 outline-none"
          >
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i} value={i} className="bg-panel">
                #{i}
              </option>
            ))}
          </select>
        </label>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            lock();
            push({ kind: 'info', title: 'Wallet locked' });
          }}
          className="border border-edge"
        >
          <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="4" y="9" width="12" height="8" rx="2" />
            <path d="M7 9V6.5a3 3 0 0 1 6 0V9" strokeLinecap="round" />
          </svg>
          Lock
        </Button>
      </div>

      <Modal open={confirmMainnet} onClose={() => setConfirmMainnet(false)} title="Switch to mainnet?">
        <div className="space-y-4">
          <Alert tone="rose" title="Real funds, real losses">
            On mainnet every transaction moves actual money and cannot be reversed, cancelled or
            refunded. Addresses are derived from the same phrase but use mainnet coin types, so your
            testnet balances will disappear from view (they are not lost — switch back to see them).
          </Alert>
          <p className="text-xs text-muted">
            Before sending anything real: verify a receive address by sending a small amount first,
            and make sure your recovery phrase is written down offline.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmMainnet(false)}>
              Stay on testnet
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmMainnet(false);
                void setMode('mainnet');
                push({ kind: 'info', title: 'Switched to mainnet', body: 'Double-check every address from here on.' });
              }}
            >
              I understand, switch to mainnet
            </Button>
          </div>
        </div>
      </Modal>
    </header>
  );
}

function BackupWarning() {
  const confirmBackup = useWallet((s) => s.confirmBackup);
  const mnemonic = useWallet((s) => s.mnemonic);
  const [open, setOpen] = React.useState(false);
  const [revealed, setRevealed] = React.useState(false);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber/30 bg-amber/8 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <svg viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 text-amber" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M10 7v4M10 14h.01" strokeLinecap="round" />
            <path d="M8.6 3.2 2.3 14a1.6 1.6 0 0 0 1.4 2.4h12.6A1.6 1.6 0 0 0 17.7 14L11.4 3.2a1.6 1.6 0 0 0-2.8 0Z" strokeLinejoin="round" />
          </svg>
          <p className="text-xs text-amber">
            <strong>Your recovery phrase is not backed up.</strong>{' '}
            <span className="text-slate-300/90">
              Clearing this browser&apos;s data would destroy the wallet permanently.
            </span>
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Back it up now
        </Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Your recovery phrase">
        <div className="space-y-4">
          <Alert tone="rose">
            Write these words on paper, in order. Anyone who reads them controls this wallet on all
            five chains — forever.
          </Alert>

          <div className="relative">
            <ol
              className={classNames(
                'grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-edge bg-void p-4 sm:grid-cols-3',
                !revealed && 'blur-sm select-none',
              )}
            >
              {(mnemonic ?? '').split(' ').map((word, i) => (
                <li key={`${word}-${i}`} className="flex items-baseline gap-2 text-sm">
                  <span className="tnum w-5 text-right text-[11px] text-dim">{i + 1}</span>
                  <span className="font-mono text-slate-100">{word}</span>
                </li>
              ))}
            </ol>
            {!revealed && (
              <button
                onClick={() => setRevealed(true)}
                className="absolute inset-0 grid place-items-center rounded-xl bg-void/40 text-sm"
              >
                <span className="rounded-lg border border-edge bg-panel px-4 py-2 text-slate-100">
                  Tap to reveal
                </span>
              </button>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Later
            </Button>
            <Button
              variant="primary"
              disabled={!revealed}
              onClick={() => {
                confirmBackup();
                setOpen(false);
                setRevealed(false);
              }}
            >
              I have written it down
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
