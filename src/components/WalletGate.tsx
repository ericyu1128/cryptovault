'use client';

import * as React from 'react';

import { invalidWords, normalizeMnemonic, validateMnemonic } from '@/lib/crypto/mnemonic';
import { scorePassword } from '@/lib/crypto/vault';
import { classNames } from '@/lib/format';
import { useToasts } from '@/state/toastStore';
import { useWallet } from '@/state/walletStore';
import { Alert, Badge, Button, CopyButton, Input, Label, Textarea } from './ui';

type Step = 'welcome' | 'create-password' | 'create-reveal' | 'create-verify' | 'import' | 'unlock';

export default function WalletGate() {
  const status = useWallet((s) => s.status);
  const onboarding = useWallet((s) => s.onboarding);
  const [step, setStep] = React.useState<Step>(status === 'locked' ? 'unlock' : 'welcome');

  React.useEffect(() => {
    // While onboarding, `status` has already flipped to 'unlocked' but the user
    // is still on the reveal/verify screens - leave the step alone.
    if (onboarding) return;
    setStep(status === 'locked' ? 'unlock' : 'welcome');
  }, [status, onboarding]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-5 py-12">
      <Brand />
      <div className="panel animate-rise mt-8 p-6 sm:p-7">
        {step === 'welcome' && (
          <Welcome onCreate={() => setStep('create-password')} onImport={() => setStep('import')} />
        )}

        {/* One mount point for all three create steps: switching between two
            separate conditionals would remount CreateFlow and lose the phrase. */}
        {(step === 'create-password' || step === 'create-reveal' || step === 'create-verify') && (
          <CreateFlow step={step} setStep={setStep} onBack={() => setStep('welcome')} />
        )}

        {step === 'import' && <ImportForm onBack={() => setStep('welcome')} />}
        {step === 'unlock' && <UnlockForm onReset={() => setStep('welcome')} />}
      </div>
      <SecurityFooter />
    </main>
  );
}

function Brand() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border border-edge bg-panel">
        <svg viewBox="0 0 24 24" className="size-6 text-mint" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 2.5 4 6v6c0 4.6 3.3 8.3 8 9.5 4.7-1.2 8-4.9 8-9.5V6l-8-3.5Z" strokeLinejoin="round" />
          <path d="M9.5 12.2 11.3 14l3.4-3.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-50">CryptoVault</h1>
      <p className="mt-1.5 text-sm text-muted">
        Self-custodial wallet for Bitcoin, Ethereum, Solana, XRP and TON
      </p>
    </div>
  );
}

function Welcome({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <div className="space-y-5">
      <Alert tone="amber" title="Read this before you start">
        CryptoVault runs entirely in this browser. Your recovery phrase is encrypted with your
        password and stored in this browser&apos;s local storage — it is never sent anywhere. That
        also means <strong className="text-amber">nobody can recover it for you.</strong> Clear your
        browser data without a written backup and the funds are gone permanently.
      </Alert>

      <div className="grid gap-3">
        <Button variant="primary" size="lg" onClick={onCreate}>
          Create a new wallet
        </Button>
        <Button size="lg" onClick={onImport}>
          Import an existing recovery phrase
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- create flow */

function CreateFlow({
  step,
  setStep,
  onBack,
}: {
  step: Step;
  setStep: (s: Step) => void;
  onBack: () => void;
}) {
  const createWallet = useWallet((s) => s.createWallet);
  const confirmBackup = useWallet((s) => s.confirmBackup);
  const push = useToasts((s) => s.push);

  const [words, setWords] = React.useState<12 | 24>(12);
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [phrase, setPhrase] = React.useState('');
  const [revealed, setRevealed] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);

  const strength = scorePassword(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= 8 && !mismatch && strength.score >= 2;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const generated = await createWallet(words, password);
      setPhrase(generated);
      setStep('create-reveal');
    } catch (err) {
      push({ kind: 'error', title: 'Could not create wallet', body: message(err) });
    } finally {
      setBusy(false);
      setPassword('');
      setConfirm('');
    }
  }

  if (step === 'create-password') {
    return (
      <form onSubmit={handleCreate} className="space-y-5">
        <Header title="Create a new wallet" onBack={onBack} />

        <div>
          <Label>Recovery phrase length</Label>
          <div className="grid grid-cols-2 gap-2">
            {([12, 24] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setWords(n)}
                className={classNames(
                  'rounded-xl border px-4 py-3 text-left transition-colors',
                  words === n ? 'border-mint/50 bg-mint/8' : 'border-edge bg-panel-2 hover:border-slate-600',
                )}
              >
                <p className="text-sm font-medium text-slate-100">{n} words</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {n === 12 ? '128-bit entropy · standard' : '256-bit entropy · paranoid'}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="pw">Unlock password</Label>
          <Input
            id="pw"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 12 characters"
          />
          {password.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={classNames(
                      'h-1 flex-1 rounded-full transition-colors',
                      i < strength.score
                        ? strength.score >= 3
                          ? 'bg-mint'
                          : 'bg-amber'
                        : 'bg-edge',
                    )}
                  />
                ))}
              </div>
              <p className="text-[11px] text-muted">
                {strength.label}
                {strength.problems.length > 0 && ` — ${strength.problems[0]}`}
              </p>
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="pw2">Confirm password</Label>
          <Input
            id="pw2"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch && <p className="mt-1.5 text-[11px] text-rose">Passwords do not match</p>}
        </div>

        <Alert tone="violet">
          This password encrypts your phrase on this device with AES-256-GCM (PBKDF2-SHA256,
          600,000 iterations). It is not a login — there is no server and no reset link.
        </Alert>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!canSubmit}>
          Generate recovery phrase
        </Button>
      </form>
    );
  }

  if (step === 'create-reveal') {
    const list = phrase.split(' ');
    return (
      <div className="space-y-5">
        <Header title="Write these words down" />

        <Alert tone="rose" title="This screen will not be shown again">
          Anyone who sees these {list.length} words owns every coin in this wallet, on every chain.
          Write them on paper in order. Do not photograph them, do not put them in a password
          manager note, do not paste them into a chat — including with an AI assistant.
        </Alert>

        <div className="relative">
          <ol
            className={classNames(
              'grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-edge bg-void p-4 sm:grid-cols-3',
              !revealed && 'blur-sm select-none',
            )}
          >
            {list.map((word, i) => (
              <li key={`${word}-${i}`} className="flex items-baseline gap-2 text-sm">
                <span className="tnum w-5 text-right text-[11px] text-dim">{i + 1}</span>
                <span className="font-mono text-slate-100">{word}</span>
              </li>
            ))}
          </ol>
          {!revealed && (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="absolute inset-0 grid place-items-center rounded-xl bg-void/40 text-sm font-medium text-slate-100"
            >
              <span className="rounded-lg border border-edge bg-panel px-4 py-2">
                Tap to reveal — make sure nobody is watching
              </span>
            </button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <CopyButton value={phrase} label="Copy phrase (risky)" />
          <span className="text-[11px] text-dim">{list.length} words · BIP-39</span>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-mint)]"
          />
          I have written the phrase down offline and understand that losing it means losing the funds.
        </label>

        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!revealed || !acknowledged}
          onClick={() => setStep('create-verify')}
        >
          Continue to verification
        </Button>
      </div>
    );
  }

  return (
    <VerifyPhrase
      phrase={phrase}
      onDone={() => {
        confirmBackup();
        push({ kind: 'success', title: 'Wallet ready', body: 'Backup confirmed. Addresses derived for all five chains.' });
      }}
      onBack={() => setStep('create-reveal')}
    />
  );
}

/** Asks for three random words to prove the phrase was actually written down. */
function VerifyPhrase({
  phrase,
  onDone,
  onBack,
}: {
  phrase: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const words = React.useMemo(() => phrase.split(' '), [phrase]);
  const targets = React.useMemo(() => {
    const idx = new Set<number>();
    while (idx.size < 3) idx.add(Math.floor(Math.random() * words.length));
    return [...idx].sort((a, b) => a - b);
  }, [words]);

  const [answers, setAnswers] = React.useState<Record<number, string>>({});
  const allCorrect = targets.every((i) => (answers[i] ?? '').trim().toLowerCase() === words[i]);

  return (
    <div className="space-y-5">
      <Header title="Confirm your backup" onBack={onBack} />
      <p className="text-sm text-muted">Type the following words from the phrase you just wrote down.</p>

      <div className="space-y-3">
        {targets.map((i) => {
          const value = answers[i] ?? '';
          const correct = value.trim().toLowerCase() === words[i];
          return (
            <div key={i}>
              <Label htmlFor={`w${i}`}>Word #{i + 1}</Label>
              <Input
                id={`w${i}`}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={value}
                onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                className={classNames(
                  value.length > 0 && (correct ? 'border-mint/50' : 'border-rose/50'),
                )}
              />
            </div>
          );
        })}
      </div>

      <Button variant="primary" size="lg" className="w-full" disabled={!allCorrect} onClick={onDone}>
        Open my wallet
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------- import flow */

function ImportForm({ onBack }: { onBack: () => void }) {
  const importWallet = useWallet((s) => s.importWallet);
  const push = useToasts((s) => s.push);

  const [phrase, setPhrase] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const normalized = normalizeMnemonic(phrase);
  const wordCount = normalized ? normalized.split(' ').length : 0;
  const unknown = invalidWords(phrase);
  const phraseOk = wordCount > 0 && validateMnemonic(phrase);
  const strength = scorePassword(password);
  const canSubmit = phraseOk && password.length >= 8 && password === confirm && strength.score >= 2;

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await importWallet(phrase, password);
      push({ kind: 'success', title: 'Wallet imported', body: 'Addresses derived for all five chains.' });
    } catch (err) {
      push({ kind: 'error', title: 'Import failed', body: message(err) });
    } finally {
      setBusy(false);
      setPhrase('');
      setPassword('');
      setConfirm('');
    }
  }

  return (
    <form onSubmit={handleImport} className="space-y-5">
      <Header title="Import a recovery phrase" onBack={onBack} />

      <div>
        <Label htmlFor="phrase">BIP-39 phrase (12 or 24 words)</Label>
        <Textarea
          id="phrase"
          rows={4}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="witch collapse practice feed shame open despair creek road again ice least"
          className="font-mono text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <Badge tone={wordCount === 12 || wordCount === 24 ? 'mint' : 'neutral'}>{wordCount} words</Badge>
          {unknown.length > 0 && <Badge tone="rose">Not in wordlist: {unknown.slice(0, 3).join(', ')}</Badge>}
          {wordCount >= 12 && unknown.length === 0 && !phraseOk && (
            <Badge tone="rose">Checksum invalid — word order is probably wrong</Badge>
          )}
          {phraseOk && <Badge tone="mint">Valid BIP-39 checksum</Badge>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="ipw">New unlock password</Label>
          <Input id="ipw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ipw2">Confirm</Label>
          <Input id="ipw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
      </div>

      <Alert tone="amber">
        Only import a phrase you generated yourself or already control. A phrase shared with you is a
        phrase someone else can still spend from.
      </Alert>

      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!canSubmit}>
        Import wallet
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------- unlock form */

function UnlockForm({ onReset }: { onReset: () => void }) {
  const unlock = useWallet((s) => s.unlock);
  const wipe = useWallet((s) => s.wipe);
  const push = useToasts((s) => s.push);

  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [confirmWipe, setConfirmWipe] = React.useState(false);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await unlock(password);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  return (
    <form onSubmit={handleUnlock} className="space-y-5">
      <Header title="Unlock your wallet" />

      <div>
        <Label htmlFor="upw">Password</Label>
        <Input
          id="upw"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="mt-1.5 text-[11px] text-rose">{error}</p>}
        <p className="mt-2 text-[11px] text-dim">
          Decryption runs 600,000 PBKDF2 iterations — it takes about a second on purpose.
        </p>
      </div>

      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={password.length === 0}>
        Unlock
      </Button>

      <div className="border-t border-edge pt-4">
        {!confirmWipe ? (
          <button
            type="button"
            onClick={() => setConfirmWipe(true)}
            className="text-[11px] text-dim underline-offset-2 hover:text-muted hover:underline"
          >
            Forgot your password? Reset this wallet
          </button>
        ) : (
          <div className="space-y-3">
            <Alert tone="rose" title="This deletes the encrypted phrase from this browser">
              There is no way to recover it afterwards without your written 12/24 words. Only do this
              if you have the phrase somewhere safe.
            </Alert>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  wipe();
                  onReset();
                  push({ kind: 'info', title: 'Wallet removed from this browser' });
                }}
              >
                Delete and start over
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmWipe(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}

/* ----------------------------------------------------------------- helpers */

function Header({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="flex items-center gap-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg p-1 text-dim transition-colors hover:bg-panel-2 hover:text-slate-100"
          aria-label="Back"
        >
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 4 6 10l6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <h2 className="text-base font-semibold text-slate-50">{title}</h2>
    </div>
  );
}

function SecurityFooter() {
  return (
    <p className="mt-6 text-center text-[11px] leading-relaxed text-dim">
      No accounts, no servers, no telemetry. Keys are generated with{' '}
      <code className="font-mono text-muted">crypto.getRandomValues</code> and never leave this tab.
      <br />
      Audit the code before trusting it with real money.
    </p>
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
