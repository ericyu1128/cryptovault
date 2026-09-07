'use client';

import * as React from 'react';

import { CHAIN_METAS, CHAIN_ORDER } from '@/lib/chains/meta';
import { ESPLORA, EVM, SOLANA, TON, XRPL } from '@/lib/chains/networks';
import { PBKDF2_ITERATIONS, decryptVault, loadVault } from '@/lib/crypto/vault';
import { classNames } from '@/lib/format';
import { useToasts } from '@/state/toastStore';
import { useWallet } from '@/state/walletStore';
import { Alert, Badge, Button, Card, CopyButton, Input, Label, Modal, SectionTitle, Select } from '../ui';

export default function SettingsTab() {
  const settings = useWallet((s) => s.settings);
  const accounts = useWallet((s) => s.accounts);
  const patchSettings = useWallet((s) => s.patchSettings);
  const setBtcAddressType = useWallet((s) => s.setBtcAddressType);
  const wipe = useWallet((s) => s.wipe);
  const push = useToasts((s) => s.push);

  const [exporting, setExporting] = React.useState(false);
  const [wiping, setWiping] = React.useState(false);

  const endpoints = [
    { name: 'Bitcoin (Esplora)', url: ESPLORA[settings.mode] },
    { name: `Ethereum (${EVM[settings.mode].name})`, url: EVM[settings.mode].rpc },
    { name: 'Solana', url: SOLANA[settings.mode].rpc },
    { name: 'XRP Ledger', url: XRPL[settings.mode].rpc },
    { name: 'TON', url: TON[settings.mode].rpc },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <SectionTitle title="Security" />
        <div className="space-y-4">
          <div>
            <Label htmlFor="autolock">Auto-lock after inactivity</Label>
            <Select
              id="autolock"
              value={settings.autoLockMinutes}
              onChange={(e) => patchSettings({ autoLockMinutes: Number(e.target.value) })}
            >
              <option value={1}>1 minute</option>
              <option value={5}>5 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={60}>1 hour</option>
              <option value={0}>Never (not recommended)</option>
            </Select>
            <p className="mt-1.5 text-[11px] text-dim">
              Locking wipes the decrypted phrase from memory. The encrypted copy stays on disk.
            </p>
          </div>

          <div className="rounded-xl border border-edge bg-void p-3.5 text-[11px] text-muted">
            <p className="mb-2 font-medium text-slate-200">Vault encryption</p>
            <dl className="space-y-1.5">
              <Row label="Cipher">AES-256-GCM</Row>
              <Row label="KDF">PBKDF2-HMAC-SHA256</Row>
              <Row label="Iterations">{PBKDF2_ITERATIONS.toLocaleString()}</Row>
              <Row label="Storage">localStorage (this origin only)</Row>
            </dl>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setExporting(true)}>Reveal recovery phrase</Button>
            <Button variant="danger" onClick={() => setWiping(true)}>
              Delete wallet from this browser
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Bitcoin address type" hint="Both are derived from the same phrase; this picks which one spends and receives." />
        <div className="grid gap-2">
          {(['segwit', 'taproot'] as const).map((type) => (
            <button
              key={type}
              onClick={() => void setBtcAddressType(type)}
              className={classNames(
                'rounded-xl border px-4 py-3 text-left transition-colors',
                settings.btcAddressType === type
                  ? 'border-mint/50 bg-mint/8'
                  : 'border-edge bg-panel-2 hover:border-slate-600',
              )}
            >
              <p className="text-sm font-medium text-slate-100">
                {type === 'segwit' ? 'Native SegWit (BIP-84)' : 'Taproot (BIP-86)'}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-dim">
                {type === 'segwit' ? "m/84'/…  bc1q…" : "m/86'/…  bc1p…"}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                {type === 'segwit'
                  ? 'Cheapest and universally accepted.'
                  : 'Smaller inputs, better privacy, not accepted everywhere yet.'}
              </p>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle title="Derivation paths" hint={`Account #${settings.accountIndex} on ${settings.mode}.`} />
        <ul className="divide-y divide-edge-soft text-xs">
          {CHAIN_ORDER.map((chain) => {
            const account = accounts[chain];
            return (
              <li key={chain} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-slate-200">{CHAIN_METAS[chain].name}</p>
                  <p className="truncate font-mono text-[11px] text-dim">
                    {account?.derivationPath ?? '—'}
                  </p>
                </div>
                {account && <CopyButton value={account.address} label="Address" />}
              </li>
            );
          })}
        </ul>
        <Alert tone="violet" className="mt-4">
          TON uses SLIP-0010 at <code className="font-mono">m/44&apos;/607&apos;/N&apos;</code> (the Trust
          Wallet convention). Tonkeeper derives from TON&apos;s own mnemonic scheme, so importing this
          phrase there gives a different address — use the address shown here.
        </Alert>
      </Card>

      <Card>
        <SectionTitle title="RPC endpoints" hint="Override any of these in .env.local." />
        <ul className="divide-y divide-edge-soft text-xs">
          {endpoints.map((e) => (
            <li key={e.name} className="flex items-center justify-between gap-3 py-2.5">
              <span className="shrink-0 text-slate-200">{e.name}</span>
              <span className="truncate font-mono text-[11px] text-dim">{e.url}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center gap-2">
          <Badge tone={settings.mode === 'testnet' ? 'violet' : 'amber'}>{settings.mode}</Badge>
          <span className="text-[11px] text-dim">
            Requests go straight from your browser to these nodes. They can see your IP and the
            addresses you query.
          </span>
        </div>
      </Card>

      <RevealPhraseModal open={exporting} onClose={() => setExporting(false)} />

      <Modal open={wiping} onClose={() => setWiping(false)} title="Delete this wallet?">
        <div className="space-y-4">
          <Alert tone="rose" title="This is irreversible">
            The encrypted phrase, tracked tokens and deployment history are removed from this
            browser. Without your written 12/24 words the funds are unrecoverable.
          </Alert>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setWiping(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                wipe();
                setWiping(false);
                push({ kind: 'info', title: 'Wallet deleted from this browser' });
              }}
            >
              Delete permanently
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function RevealPhraseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = React.useState('');
  const [phrase, setPhrase] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setPassword('');
      setPhrase('');
      setError('');
    }
  }, [open]);

  async function handleReveal(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const vault = loadVault();
      if (!vault) throw new Error('No wallet stored in this browser');
      // Re-derive from the vault rather than reading it out of memory: this way
      // revealing the phrase always costs a password.
      setPhrase(await decryptVault(vault, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Reveal recovery phrase">
      {phrase ? (
        <div className="space-y-4">
          <Alert tone="rose">
            Anyone who reads these words controls this wallet on every chain. Close this dialog as
            soon as you have written them down.
          </Alert>
          <ol className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-edge bg-void p-4 sm:grid-cols-3">
            {phrase.split(' ').map((word, i) => (
              <li key={`${word}-${i}`} className="flex items-baseline gap-2 text-sm">
                <span className="tnum w-5 text-right text-[11px] text-dim">{i + 1}</span>
                <span className="font-mono text-slate-100">{word}</span>
              </li>
            ))}
          </ol>
          <div className="flex justify-between">
            <CopyButton value={phrase} label="Copy (risky)" />
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleReveal} className="space-y-4">
          <div>
            <Label htmlFor="revealpw">Confirm your password</Label>
            <Input
              id="revealpw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="mt-1.5 text-[11px] text-rose">{error}</p>}
          </div>
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!password}>
            Reveal
          </Button>
        </form>
      )}
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-dim">{label}</dt>
      <dd className="tnum text-slate-300">{children}</dd>
    </div>
  );
}
