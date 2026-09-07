'use client';

import * as React from 'react';

import { getAdapter } from '@/lib/chains';
import { CHAIN_METAS, CHAIN_ORDER } from '@/lib/chains/meta';
import { tokensFor } from '@/lib/chains/tokens';
import type { ChainId, FeeQuote } from '@/lib/chains/types';
import { classNames, formatUnits, formatUsd, parseUnits, shortAddress, toNumber } from '@/lib/format';
import { useToasts } from '@/state/toastStore';
import { useWallet } from '@/state/walletStore';
import { Alert, Badge, Button, Card, Input, Label, Modal, SectionTitle, Select } from '../ui';

const MEMO_LABEL: Partial<Record<ChainId, { label: string; placeholder: string; hint: string }>> = {
  xrp: {
    label: 'Destination tag (optional)',
    placeholder: '123456',
    hint: 'Exchanges will not credit a deposit without their tag.',
  },
  ton: {
    label: 'Comment (optional)',
    placeholder: 'Payment for invoice #42',
    hint: 'Attached as a text comment. Exchanges use this as the memo.',
  },
  solana: {
    label: 'Memo (optional)',
    placeholder: 'invoice-42',
    hint: 'Written via the SPL Memo program.',
  },
  ethereum: {
    label: 'Calldata note (optional)',
    placeholder: 'gm',
    hint: 'Encoded as UTF-8 calldata. Adds gas; leave blank for exchange deposits.',
  },
};

export default function SendTab() {
  const accounts = useWallet((s) => s.accounts);
  const balances = useWallet((s) => s.balances);
  const prices = useWallet((s) => s.prices);
  const settings = useWallet((s) => s.settings);
  const seed = useWallet((s) => s.seed);
  const refreshBalances = useWallet((s) => s.refreshBalances);
  const push = useToasts((s) => s.push);
  const update = useToasts((s) => s.update);

  const [chain, setChain] = React.useState<ChainId>('ethereum');
  const [tokenAddress, setTokenAddress] = React.useState('');
  const [to, setTo] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [memo, setMemo] = React.useState('');
  const [feeRate, setFeeRate] = React.useState<number | undefined>();
  const [fee, setFee] = React.useState<FeeQuote | null>(null);
  const [addressValid, setAddressValid] = React.useState<boolean | null>(null);
  const [review, setReview] = React.useState(false);
  const [sending, setSending] = React.useState(false);

  const meta = CHAIN_METAS[chain];
  const balance = balances[chain];
  const account = accounts[chain];
  /**
   * Every non-native asset sendable on this chain: the verified registry plus
   * anything the user chose to track manually.
   */
  const sendableAssets = React.useMemo(() => {
    const registry = tokensFor(chain, settings.mode).filter((t) => !t.key.startsWith('w'));
    const tracked = settings.trackedTokens
      .filter((t) => t.mode === settings.mode && chain === 'ethereum')
      .filter((t) => !registry.some((r) => r.address.toLowerCase() === t.address.toLowerCase()))
      .map((t) => ({ ...t, chain, key: t.address, bridged: false }));
    return [...registry, ...tracked];
  }, [chain, settings.mode, settings.trackedTokens]);

  const token = sendableAssets.find(
    (t) => t.address.toLowerCase() === tokenAddress.toLowerCase(),
  );

  const symbol = token?.symbol ?? meta.symbol;
  const decimals = token?.decimals ?? meta.decimals;

  // Reset chain-specific inputs when the chain changes.
  React.useEffect(() => {
    setTo('');
    setAmount('');
    setMemo('');
    setTokenAddress('');
    setFeeRate(undefined);
    setAddressValid(null);
  }, [chain]);

  // Live address validation, debounced through the adapter.
  React.useEffect(() => {
    let cancelled = false;
    if (to.trim().length === 0) {
      setAddressValid(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      const adapter = await getAdapter(chain);
      if (!cancelled) setAddressValid(adapter.validateAddress(to, settings.mode));
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [to, chain, settings.mode]);

  // Fee quote refreshes when the chain or the BTC fee rate changes.
  React.useEffect(() => {
    let cancelled = false;
    setFee(null);
    void (async () => {
      try {
        const adapter = await getAdapter(chain);
        const quote = await adapter.estimateFee({
          mode: settings.mode,
          accountIndex: settings.accountIndex,
          to: to || account?.address || '',
          amount: amount || '0',
          btcAddressType: settings.btcAddressType,
          feeRate,
          tokenAddress: tokenAddress || undefined,
        });
        if (!cancelled) setFee(quote);
      } catch {
        if (!cancelled) setFee(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `to`/`amount` deliberately excluded: refetching a fee on every keystroke
    // hammers the RPC and the numbers barely move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, settings.mode, settings.accountIndex, settings.btcAddressType, feeRate, tokenAddress]);

  const spendableRaw = React.useMemo(() => {
    if (token) return undefined; // token balances live in TokenList
    if (!balance) return undefined;
    const reserved = balance.reservedRaw ?? 0n;
    const feeRaw = fee?.raw ?? 0n;
    const value = balance.raw - reserved - feeRaw;
    return value > 0n ? value : 0n;
  }, [balance, fee, token]);

  let amountError = '';
  if (amount.trim().length > 0) {
    try {
      const parsed = parseUnits(amount, decimals);
      if (parsed <= 0n) amountError = 'Enter an amount greater than zero';
      else if (!token && spendableRaw !== undefined && parsed > spendableRaw) {
        amountError = 'More than the spendable balance after fees and reserves';
      }
    } catch (err) {
      amountError = err instanceof Error ? err.message : 'Invalid amount';
    }
  }

  const canReview =
    Boolean(seed) &&
    addressValid === true &&
    amount.trim().length > 0 &&
    amountError === '' &&
    (tokenAddress === '' || Boolean(token));

  async function handleSend() {
    if (!seed) return;
    setReview(false);
    setSending(true);

    const toastId = push({
      kind: 'pending',
      title: `Sending ${amount} ${symbol}`,
      body: `to ${shortAddress(to, 10, 8)} — signing locally and broadcasting…`,
    });

    try {
      const adapter = await getAdapter(chain);
      const result = await adapter.send({
        seed,
        mode: settings.mode,
        accountIndex: settings.accountIndex,
        to: to.trim(),
        amount: amount.trim(),
        memo: memo.trim() || undefined,
        tokenAddress: tokenAddress || undefined,
        btcAddressType: settings.btcAddressType,
        feeRate,
      });

      update(toastId, {
        kind: 'success',
        title: `Sent ${amount} ${symbol}`,
        body: shortAddress(result.hash, 12, 10),
        link: { href: result.explorerUrl, label: 'View in explorer' },
        duration: 15000,
      });

      setAmount('');
      setTo('');
      setMemo('');
      window.setTimeout(() => void refreshBalances(), 4000);
    } catch (err) {
      update(toastId, {
        kind: 'error',
        title: 'Transaction failed',
        body: err instanceof Error ? err.message : String(err),
        duration: 20000,
      });
    } finally {
      setSending(false);
    }
  }

  const memoConfig = MEMO_LABEL[chain];
  const price = prices[chain];
  const amountUsd =
    !token && price && amount && !amountError
      ? (() => {
          try {
            return toNumber(parseUnits(amount, decimals), decimals) * price;
          } catch {
            return null;
          }
        })()
      : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
      <Card>
        <SectionTitle
          title="Send"
          hint="Transactions are signed in this tab with a key derived on the fly, then broadcast straight to a public node."
        />

        <div className="space-y-4">
          <div>
            <Label>Chain</Label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {CHAIN_ORDER.map((id) => {
                const m = CHAIN_METAS[id];
                const active = chain === id;
                return (
                  <button
                    key={id}
                    onClick={() => setChain(id)}
                    className={classNames(
                      'rounded-xl border px-2 py-2.5 text-center transition-colors',
                      active ? 'border-transparent' : 'border-edge bg-panel-2 hover:border-slate-600',
                    )}
                    style={active ? { backgroundColor: `${m.accent}1f`, borderColor: `${m.accent}66` } : undefined}
                  >
                    <p
                      className="text-xs font-semibold"
                      style={{ color: active ? m.accent : undefined }}
                    >
                      {m.symbol}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-dim">{m.name}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {sendableAssets.length > 0 && (
            <div>
              <Label htmlFor="asset">Asset</Label>
              <Select id="asset" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)}>
                <option value="">
                  {meta.symbol} (native)
                </option>
                {sendableAssets.map((t) => (
                  <option key={t.address} value={t.address}>
                    {t.symbol} — {t.name}
                  </option>
                ))}
              </Select>
              {token?.bridged && (
                <p className="mt-1.5 text-[11px] text-amber/80">
                  Binance-Peg wrapper, not issuer-native. {token.decimals} decimals on this chain.
                </p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="to">Recipient address</Label>
            <Input
              id="to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={`${meta.name} address`}
              spellCheck={false}
              autoComplete="off"
              className={classNames(
                'font-mono text-xs',
                addressValid === false && 'border-rose/50',
                addressValid === true && 'border-mint/40',
              )}
            />
            {addressValid === false && (
              <p className="mt-1.5 text-[11px] text-rose">
                Not a valid {meta.name} address for {settings.mode}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="amount">Amount</Label>
              {spendableRaw !== undefined && (
                <button
                  type="button"
                  onClick={() => setAmount(formatUnits(spendableRaw, decimals, decimals).replace(/,/g, ''))}
                  className="mb-1.5 text-[11px] text-mint hover:underline"
                >
                  Max {formatUnits(spendableRaw, decimals, 6)} {symbol}
                </button>
              )}
            </div>
            <div className="relative">
              <Input
                id="amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                className={classNames('tnum pr-16', amountError && 'border-rose/50')}
              />
              <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs font-medium text-dim">
                {symbol}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[11px] text-rose">{amountError}</span>
              {amountUsd !== null && <span className="text-[11px] text-dim">≈ {formatUsd(amountUsd)}</span>}
            </div>
          </div>

          {chain === 'bitcoin' && (
            <div>
              <Label htmlFor="feerate">Fee rate (sat/vB) — blank uses the 30-minute estimate</Label>
              <Input
                id="feerate"
                value={feeRate ?? ''}
                onChange={(e) => setFeeRate(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="auto"
                inputMode="numeric"
                className="tnum"
              />
            </div>
          )}

          {memoConfig && (
            <div>
              <Label htmlFor="memo">{memoConfig.label}</Label>
              <Input
                id="memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder={memoConfig.placeholder}
              />
              <p className="mt-1.5 text-[11px] text-dim">{memoConfig.hint}</p>
            </div>
          )}

          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!canReview}
            loading={sending}
            onClick={() => setReview(true)}
          >
            Review transaction
          </Button>
        </div>
      </Card>

      <div className="space-y-5">
        <Card>
          <SectionTitle title="From" />
          {account ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-edge bg-void p-3">
                <p className="font-mono text-[11px] break-all text-slate-100">{account.address}</p>
                <p className="mt-1.5 font-mono text-[10px] text-dim">{account.derivationPath}</p>
              </div>
              <dl className="space-y-2 text-xs">
                <Row label="Balance">
                  {balance ? `${formatUnits(balance.raw, balance.decimals, 8)} ${meta.symbol}` : '—'}
                </Row>
                {balance?.reservedRaw !== undefined && balance.reservedRaw > 0n && (
                  <Row label="Reserved">
                    {formatUnits(balance.reservedRaw, balance.decimals, 6)} {meta.symbol}
                  </Row>
                )}
                <Row label={fee?.label ?? 'Network fee'}>
                  {fee ? `${formatUnits(fee.raw, fee.decimals, 8)} ${fee.symbol}` : 'estimating…'}
                </Row>
                {fee?.detail && <Row label="Rate">{fee.detail}</Row>}
              </dl>
            </div>
          ) : (
            <p className="text-xs text-muted">Deriving account…</p>
          )}
        </Card>

        <Alert tone="amber" title="Transactions cannot be undone">
          There is no support desk and no chargeback. Paste the address, then read the first and last
          six characters back against the source before you confirm.
          {meta.note && <span className="mt-1.5 block text-slate-400">{meta.note}</span>}
        </Alert>
      </div>

      <Modal open={review} onClose={() => setReview(false)} title="Confirm transaction">
        <div className="space-y-4">
          <div className="rounded-xl border border-edge bg-void p-4">
            <p className="tnum text-center text-2xl font-semibold text-slate-50">
              {amount} {symbol}
            </p>
            {amountUsd !== null && (
              <p className="mt-1 text-center text-xs text-dim">≈ {formatUsd(amountUsd)}</p>
            )}
          </div>

          <dl className="space-y-2.5 text-xs">
            <Row label="Network">
              <Badge tone={settings.mode === 'testnet' ? 'violet' : 'amber'}>
                {settings.mode === 'testnet' ? meta.testnetLabel : meta.mainnetLabel}
              </Badge>
            </Row>
            <Row label="To">
              <span className="font-mono break-all">{to}</span>
            </Row>
            <Row label="From">
              <span className="font-mono">{shortAddress(account?.address ?? '', 10, 8)}</span>
            </Row>
            {fee && (
              <Row label="Fee">
                {formatUnits(fee.raw, fee.decimals, 8)} {fee.symbol}
              </Row>
            )}
            {memo && <Row label="Memo">{memo}</Row>}
          </dl>

          {settings.mode === 'mainnet' && (
            <Alert tone="rose">You are on mainnet. This moves real funds and is irreversible.</Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReview(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleSend()}>
              Sign &amp; broadcast
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-dim">{label}</dt>
      <dd className="tnum min-w-0 text-right text-slate-200">{children}</dd>
    </div>
  );
}
