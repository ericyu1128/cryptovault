'use client';

import * as React from 'react';

import { CHAIN_METAS, CHAIN_ORDER } from '@/lib/chains/meta';
import { FAUCETS } from '@/lib/chains/networks';
import { getAdapter } from '@/lib/chains';
import type { ChainBalance, ChainId, DerivedAccount, NetworkMode } from '@/lib/chains/types';
import { formatUnits, formatUsd, shortAddress, toNumber } from '@/lib/format';
import { useWallet } from '@/state/walletStore';
import ReceiveModal from '../ReceiveModal';
import TokenList from '../TokenList';
import { Alert, Badge, Button, Card, CopyButton, SectionTitle, Skeleton } from '../ui';

export default function PortfolioTab() {
  const accounts = useWallet((s) => s.accounts);
  const balances = useWallet((s) => s.balances);
  const errors = useWallet((s) => s.balanceErrors);
  const refreshing = useWallet((s) => s.refreshing);
  const refresh = useWallet((s) => s.refreshBalances);
  const prices = useWallet((s) => s.prices);
  const mode = useWallet((s) => s.settings.mode);
  const hideBalances = useWallet((s) => s.settings.hideBalances);
  const patchSettings = useWallet((s) => s.patchSettings);

  const [receiving, setReceiving] = React.useState<DerivedAccount | null>(null);
  const [explorerUrls, setExplorerUrls] = React.useState<Partial<Record<ChainId, string>>>({});

  // Balances load once on mount and then only when the user asks.
  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Partial<Record<ChainId, string>> = {};
      for (const chain of CHAIN_ORDER) {
        const account = accounts[chain];
        if (!account) continue;
        const adapter = await getAdapter(chain);
        next[chain] = adapter.explorerAddress(account.address, mode);
      }
      if (!cancelled) setExplorerUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [accounts, mode]);

  const totalUsd = CHAIN_ORDER.reduce((sum, chain) => {
    const balance = balances[chain];
    const price = prices[chain];
    if (!balance || !price) return sum;
    return sum + toNumber(balance.raw, balance.decimals) * price;
  }, 0);

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs text-muted">
              Total {mode === 'testnet' ? 'test ' : ''}portfolio value
            </p>
            <p className="tnum mt-1 text-3xl font-semibold tracking-tight text-slate-50">
              {hideBalances ? '••••••' : formatUsd(totalUsd)}
            </p>
            <p className="mt-1.5 text-[11px] text-dim">
              {mode === 'testnet'
                ? 'Priced at mainnet rates for reference — testnet coins are worth nothing.'
                : 'Live rates from CoinGecko, refreshed each time you reload balances.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="border border-edge"
              onClick={() => patchSettings({ hideBalances: !hideBalances })}
            >
              {hideBalances ? 'Show' : 'Hide'} balances
            </Button>
            <Button size="sm" loading={refreshing} onClick={() => void refresh()}>
              <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v3.5h-3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      <BuyCryptoCard />

      <div>
        <SectionTitle
          title="Accounts"
          hint="One BIP-39 phrase, five independent key trees. Tap an address to receive."
        />

        <div className="grid gap-3">
          {CHAIN_ORDER.map((chain) => (
            <ChainRow
              key={chain}
              chain={chain}
              account={accounts[chain]}
              balance={balances[chain]}
              error={errors[chain]}
              price={prices[chain]}
              mode={mode}
              hideBalances={hideBalances}
              explorerUrl={explorerUrls[chain]}
              onReceive={() => {
                const acct = accounts[chain];
                if (acct) setReceiving(acct);
              }}
            />
          ))}
        </div>
      </div>

      {mode === 'testnet' && (
        <Alert tone="violet" title="Need test coins?">
          <div className="mt-1.5 flex flex-wrap gap-2">
            {CHAIN_ORDER.map((chain) => (
              <a
                key={chain}
                href={FAUCETS[chain]}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-lg border border-edge bg-panel px-2.5 py-1 text-[11px] text-slate-200 transition-colors hover:border-slate-600"
              >
                {CHAIN_METAS[chain].symbol} faucet ↗
              </a>
            ))}
          </div>
        </Alert>
      )}

      <TokenList />

      <ReceiveModal account={receiving} onClose={() => setReceiving(null)} />
    </div>
  );
}

function BuyCryptoCard() {
  return (
    <Card className="relative overflow-hidden border-mint/25 bg-gradient-to-br from-mint/10 via-panel to-panel">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="max-w-md">
          <div className="flex items-center gap-2">
            <Badge tone="mint">0% fees</Badge>
          </div>
          <h3 className="mt-2.5 text-base font-semibold tracking-tight text-slate-50">Buy Crypto</h3>
          <p className="mt-1.5 text-sm text-muted">Fill out the form to buy crypto with 0% fees.</p>
          <p className="mt-2 text-xs text-mint">
            Enter promo code <span className="font-semibold">VAULTED</span> for a free $20 bonus to
            your purchase.
          </p>
        </div>

        <a href="https://forms.gle/APTedb1E6xE1XjGGA" target="_blank" rel="noopener noreferrer">
          <Button variant="primary" size="lg">
            Buy Crypto
            <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 13 13 7M8 7h5v5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        </a>
      </div>
    </Card>
  );
}

function ChainRow({
  chain,
  account,
  balance,
  error,
  price,
  mode,
  hideBalances,
  explorerUrl,
  onReceive,
}: {
  chain: ChainId;
  account?: DerivedAccount;
  balance?: ChainBalance;
  error?: string;
  price?: number;
  mode: NetworkMode;
  hideBalances: boolean;
  explorerUrl?: string;
  onReceive: () => void;
}) {
  const meta = CHAIN_METAS[chain];
  const amount = balance ? formatUnits(balance.raw, balance.decimals, 8) : null;
  const usd = balance && price ? toNumber(balance.raw, balance.decimals) * price : null;

  return (
    // basis-full on the identity block makes this one row on desktop and two on
    // a phone: name + address, then balance + action underneath.
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 transition-colors hover:border-slate-700">
      <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-auto">
        <div
          className="grid size-10 shrink-0 place-items-center rounded-xl text-xs font-bold"
          style={{ backgroundColor: `${meta.accent}1f`, color: meta.accent }}
        >
          {meta.symbol.slice(0, 3)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-slate-100">{meta.name}</p>
            <Badge tone={mode === 'testnet' ? 'violet' : 'neutral'}>
              {mode === 'testnet' ? meta.testnetLabel : meta.mainnetLabel}
            </Badge>
            {balance?.unfunded && <Badge tone="amber">Not funded yet</Badge>}
          </div>

          {account ? (
            <div className="mt-1 flex items-center gap-1">
              <button
                onClick={onReceive}
                className="font-mono text-[11px] text-muted transition-colors hover:text-slate-100"
                title={account.address}
              >
                  {shortAddress(account.address, 10, 8)}
              </button>
              <CopyButton value={account.address} label="" className="px-1" />
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-lg px-1.5 py-1 text-dim transition-colors hover:text-slate-100"
                  aria-label="Open in block explorer"
                >
                  <svg viewBox="0 0 20 20" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M7 13 13 7M8 7h5v5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              )}
            </div>
          ) : (
            <Skeleton className="mt-1.5 h-3 w-40" />
          )}
        </div>
      </div>

      <div className="ml-auto text-right">
        {error ? (
          // RPC errors can be long and contain unbreakable strings (addresses,
          // URLs); clamp hard so they never push into the Receive button.
          <p
            className="ml-auto line-clamp-2 max-w-[11rem] text-[11px] break-all text-rose"
            title={error}
          >
            {error}
          </p>
        ) : amount === null ? (
          <>
            <Skeleton className="ml-auto h-4 w-24" />
            <Skeleton className="mt-1.5 ml-auto h-3 w-16" />
          </>
        ) : (
          <>
            <p className="tnum text-sm font-medium text-slate-50">
              {hideBalances ? '\u2022\u2022\u2022\u2022' : `${amount} ${meta.symbol}`}
            </p>
            <p className="tnum mt-0.5 text-[11px] text-dim">
              {hideBalances ? '\u2022\u2022\u2022\u2022' : usd !== null ? formatUsd(usd) : '\u2014'}
              {balance?.reservedRaw !== undefined && balance.reservedRaw > 0n && !hideBalances && (
                <span className="ml-1.5 text-amber/80">
                  {' \u00b7 '}
                  {formatUnits(balance.reservedRaw, balance.decimals, 6)} reserved
                </span>
              )}
            </p>
          </>
        )}
      </div>

      <Button size="sm" variant="ghost" className="border border-edge" onClick={onReceive}>
        Receive
      </Button>
    </Card>
  );
}
