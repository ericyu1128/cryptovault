'use client';

import * as React from 'react';

import { CHAIN_METAS } from '@/lib/chains/meta';
import { EVM_CHAINS } from '@/lib/chains/networks';
import type { ChainId } from '@/lib/chains/types';
import { isEvmChain } from '@/lib/chains/types';
import {
  DEV_FEE_BPS,
  EVM_FEE_RECIPIENT,
  SOLANA_FEE_OWNER,
  SWAPPABLE_CHAINS,
  assetsFor,
  feeDisclosure,
  providerFor,
  providerIdFor,
  type SwapAsset,
  type SwapQuote,
  type SwapStage,
} from '@/lib/swap';
import { classNames, formatUnits, parseUnits, shortAddress } from '@/lib/format';
import { useToasts } from '@/state/toastStore';
import { useWallet } from '@/state/walletStore';
import { Alert, Badge, Button, Card, Input, Label, Modal, SectionTitle, Select, Spinner } from '../ui';

const SLIPPAGE_OPTIONS = [10, 50, 100, 300] as const;

/** Where the fee lands, per chain. Shown in the UI so it is never hidden. */
const FEE_RECIPIENTS: Partial<Record<ChainId, string>> = {
  ethereum: EVM_FEE_RECIPIENT,
  bsc: EVM_FEE_RECIPIENT,
  solana: SOLANA_FEE_OWNER,
};

const STAGE_LABEL: Record<SwapStage, string> = {
  'checking-allowance': 'Checking token allowance…',
  'resetting-allowance': 'Resetting allowance to zero (this token requires it)…',
  approving: 'Approving the router to spend your token…',
  building: 'Building the swap transaction…',
  signing: 'Signing locally…',
  broadcasting: 'Broadcasting…',
  confirming: 'Waiting for confirmation…',
};

export default function SwapTab() {
  const settings = useWallet((s) => s.settings);
  const accounts = useWallet((s) => s.accounts);
  const seed = useWallet((s) => s.seed);
  const refreshBalances = useWallet((s) => s.refreshBalances);
  const push = useToasts((s) => s.push);
  const update = useToasts((s) => s.update);

  const [chain, setChain] = React.useState<ChainId>('ethereum');
  const [assets, setAssets] = React.useState<SwapAsset[]>([]);
  const [sell, setSell] = React.useState<SwapAsset | null>(null);
  const [buy, setBuy] = React.useState<SwapAsset | null>(null);
  const [amount, setAmount] = React.useState('');
  const [slippageBps, setSlippageBps] = React.useState<number>(50);

  const [quote, setQuote] = React.useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = React.useState(false);
  const [quoteError, setQuoteError] = React.useState('');
  const [review, setReview] = React.useState(false);
  const [stage, setStage] = React.useState<SwapStage | null>(null);

  const mode = settings.mode;
  const account = accounts[chain];
  const providerId = providerIdFor(chain, mode);
  const meta = CHAIN_METAS[chain];

  // Load the tradeable asset list whenever the chain or network changes.
  React.useEffect(() => {
    let cancelled = false;
    setSell(null);
    setBuy(null);
    setQuote(null);
    setQuoteError('');
    void assetsFor(chain, mode).then((list) => {
      if (cancelled) return;
      setAssets(list);
      setSell(list[0] ?? null);
      setBuy(list[1] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [chain, mode]);

  const sellRaw = React.useMemo(() => {
    if (!sell || !amount.trim()) return null;
    try {
      const v = parseUnits(amount, sell.decimals);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [amount, sell]);

  // Debounced quote fetch.
  React.useEffect(() => {
    if (!sell || !buy || !sellRaw || !account || !providerId) {
      setQuote(null);
      return;
    }
    if (sell.address === buy.address) {
      setQuote(null);
      setQuoteError('Pick two different tokens');
      return;
    }

    let cancelled = false;
    setQuoting(true);
    setQuoteError('');

    const timer = window.setTimeout(async () => {
      try {
        const provider = await providerFor(chain, mode);
        if (!provider) throw new Error('No swap provider for this network');
        const q = await provider.quote({
          chain,
          mode,
          sell,
          buy,
          sellRaw,
          slippageBps,
          taker: account.address,
        });
        if (!cancelled) setQuote(q);
      } catch (err) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setQuoting(false);
    };
  }, [chain, mode, sell, buy, sellRaw, slippageBps, account, providerId]);

  function flip() {
    setSell(buy);
    setBuy(sell);
    setAmount('');
    setQuote(null);
  }

  async function handleSwap() {
    if (!quote || !seed) return;
    setReview(false);

    const toastId = push({
      kind: 'pending',
      title: `Swapping ${amount} ${quote.sell.symbol} → ${quote.buy.symbol}`,
      body: 'Signing locally and routing on-chain…',
    });

    try {
      const provider = await providerFor(chain, mode);
      if (!provider) throw new Error('No swap provider for this network');

      const result = await provider.execute({
        quote,
        seed,
        accountIndex: settings.accountIndex,
        onProgress: (s, detail) => {
          setStage(s);
          update(toastId, { title: STAGE_LABEL[s], body: detail ? shortAddress(detail, 10, 8) : undefined });
        },
      });

      update(toastId, {
        kind: 'success',
        title: `Swapped ${amount} ${quote.sell.symbol} for ${quote.buy.symbol}`,
        body: quote.fee.applied
          ? `Received ~${formatUnits(quote.buyRaw, quote.buy.decimals, 6)} ${quote.buy.symbol} · ${(
              DEV_FEE_BPS / 100
            ).toFixed(2)}% app fee: ${formatUnits(quote.fee.raw, quote.fee.asset.decimals, 6)} ${quote.fee.asset.symbol}`
          : `Received ~${formatUnits(quote.buyRaw, quote.buy.decimals, 6)} ${quote.buy.symbol} · no app fee on this route`,
        link: { href: result.explorerUrl, label: 'View in explorer' },
        duration: 20000,
      });

      setAmount('');
      setQuote(null);
      window.setTimeout(() => void refreshBalances(), 4000);
    } catch (err) {
      update(toastId, {
        kind: 'error',
        title: 'Swap failed',
        body: err instanceof Error ? err.message : String(err),
        duration: 20000,
      });
    } finally {
      setStage(null);
    }
  }

  const rate =
    quote && quote.sellRaw > 0n
      ? Number(formatUnits(quote.buyRaw, quote.buy.decimals, 10).replace(/,/g, '')) /
        Number(formatUnits(quote.sellRaw, quote.sell.decimals, 10).replace(/,/g, ''))
      : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
      <Card>
        <SectionTitle
          title="Swap"
          hint="Routed through a DEX aggregator. Signed in this tab; the aggregator never sees your key."
          right={<Badge tone={mode === 'testnet' ? 'violet' : 'mint'}>{providerId ?? 'unavailable'}</Badge>}
        />

        <div className="space-y-4">
          <div>
            <Label>Network</Label>
            <div className="grid grid-cols-3 gap-2">
              {SWAPPABLE_CHAINS.map((id) => {
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
                    <p className="text-xs font-semibold" style={{ color: active ? m.accent : undefined }}>
                      {m.symbol}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-dim">{m.name}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {!providerId ? (
            <Alert tone="violet" title="Swaps are mainnet-only">
              DEX aggregators route real liquidity, and there is none on{' '}
              {isEvmChain(chain) ? EVM_CHAINS[chain][mode].name : 'this test network'}. Switch the
              header to Mainnet to trade.
            </Alert>
          ) : (
            <>
              <AssetRow
                label="You pay"
                assets={assets}
                selected={sell}
                onSelect={setSell}
                amount={amount}
                onAmount={setAmount}
                editable
              />

              <div className="flex justify-center">
                <button
                  onClick={flip}
                  className="rounded-lg border border-edge bg-panel-2 p-2 text-muted transition-colors hover:text-slate-100"
                  aria-label="Swap direction"
                >
                  <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <path d="M7 4v12M7 16l-3-3M13 16V4M13 4l3 3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              <AssetRow
                label="You receive"
                assets={assets}
                selected={buy}
                onSelect={setBuy}
                amount={quote ? formatUnits(quote.buyRaw, quote.buy.decimals, 6) : ''}
                onAmount={() => undefined}
                editable={false}
                loading={quoting}
              />

              <div>
                <Label>Slippage tolerance</Label>
                <div className="grid grid-cols-4 gap-2">
                  {SLIPPAGE_OPTIONS.map((bps) => (
                    <button
                      key={bps}
                      onClick={() => setSlippageBps(bps)}
                      className={classNames(
                        'rounded-lg border px-2 py-1.5 text-xs transition-colors',
                        slippageBps === bps
                          ? 'border-mint/50 bg-mint/10 text-mint'
                          : 'border-edge bg-panel-2 text-muted hover:border-slate-600',
                      )}
                    >
                      {(bps / 100).toFixed(bps < 100 ? 1 : 0)}%
                    </button>
                  ))}
                </div>
              </div>

              {quoteError && <Alert tone="rose">{quoteError}</Alert>}

              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={!quote || quoting || !seed}
                loading={Boolean(stage)}
                onClick={() => setReview(true)}
              >
                {stage ? STAGE_LABEL[stage] : 'Review swap'}
              </Button>
            </>
          )}
        </div>
      </Card>

      <div className="space-y-5">
        {quote && <QuoteBreakdown quote={quote} rate={rate} chain={chain} />}

        <Card>
          <SectionTitle title="How the fee works" />
          <p className="text-xs leading-relaxed text-muted">{feeDisclosure(chain, mode)}</p>
          <dl className="mt-4 space-y-2 border-t border-edge pt-3 text-xs">
            <Row label="App fee">{(DEV_FEE_BPS / 100).toFixed(2)}% of the amount received</Row>
            <Row label="Collected in">
              {isEvmChain(chain) ? 'ETH/WETH when the pair has one, else the bought token' : 'the bought token'}
            </Row>
            <Row label="Paid to">
              <span className="font-mono">{shortAddress(FEE_RECIPIENTS[chain] ?? '—', 8, 6)}</span>
            </Row>
          </dl>
        </Card>

        {isEvmChain(chain) && !process.env.NEXT_PUBLIC_ZEROX_API_KEY && (
          <Alert tone="amber" title="No 0x API key configured">
            EVM swaps need a key in <code className="font-mono">NEXT_PUBLIC_ZEROX_API_KEY</code>.
            Get a free one at dashboard.0x.org. Note that any key shipped in a client bundle is
            publicly readable — scope it to this app's domains.
          </Alert>
        )}

        {account && (
          <Card>
            <SectionTitle title="Trading from" />
            <p className="font-mono text-[11px] break-all text-slate-100">{account.address}</p>
            <p className="mt-1.5 font-mono text-[10px] text-dim">{account.derivationPath}</p>
          </Card>
        )}
      </div>

      <Modal open={review} onClose={() => setReview(false)} title="Confirm swap">
        {quote && (
          <div className="space-y-4">
            <div className="rounded-xl border border-edge bg-void p-4 text-center">
              <p className="tnum text-lg font-semibold text-slate-50">
                {amount} {quote.sell.symbol}
              </p>
              <p className="my-1 text-dim">↓</p>
              <p className="tnum text-lg font-semibold text-mint">
                {formatUnits(quote.buyRaw, quote.buy.decimals, 6)} {quote.buy.symbol}
              </p>
            </div>

            <dl className="space-y-2.5 text-xs">
              <Row label="Network">{meta.name}</Row>
              <Row label="Minimum received">
                {formatUnits(quote.minBuyRaw, quote.buy.decimals, 6)} {quote.buy.symbol}
              </Row>
              <Row label="Slippage">{(quote.slippageBps / 100).toFixed(2)}%</Row>
              {quote.route && <Row label="Route">{quote.route.slice(0, 3).join(' → ')}</Row>}
              <Row label={`App fee (${(quote.fee.bps / 100).toFixed(2)}%)`}>
                {quote.fee.applied
                  ? `${formatUnits(quote.fee.raw, quote.fee.asset.decimals, 6)} ${quote.fee.asset.symbol}`
                  : 'none on this route'}
              </Row>
              {quote.fee.applied && (
                <Row label="Fee paid to">
                  <span className="font-mono">{shortAddress(quote.fee.recipient, 8, 6)}</span>
                </Row>
              )}
            </dl>

            <Alert tone={mode === 'mainnet' ? 'amber' : 'violet'}>
              The quoted output can move between now and confirmation. You are guaranteed at least
              the minimum received above, or the transaction reverts.
            </Alert>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReview(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void handleSwap()}>
                Sign &amp; swap
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function AssetRow({
  label,
  assets,
  selected,
  onSelect,
  amount,
  onAmount,
  editable,
  loading,
}: {
  label: string;
  assets: SwapAsset[];
  selected: SwapAsset | null;
  onSelect: (a: SwapAsset) => void;
  amount: string;
  onAmount: (v: string) => void;
  editable: boolean;
  loading?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            value={amount}
            onChange={(e) => onAmount(e.target.value)}
            placeholder="0.0"
            inputMode="decimal"
            readOnly={!editable}
            className={classNames('tnum', !editable && 'text-slate-300')}
          />
          {loading && <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-dim" />}
        </div>
        <Select
          value={selected?.address ?? ''}
          onChange={(e) => {
            const next = assets.find((a) => a.address === e.target.value);
            if (next) onSelect(next);
          }}
          className="w-36 shrink-0"
        >
          {assets.map((a) => (
            <option key={a.address} value={a.address} className="bg-panel">
              {a.symbol}
            </option>
          ))}
        </Select>
      </div>
      {selected?.bridged && (
        <p className="mt-1.5 text-[11px] text-amber/80">
          Bridged token — a Binance-Peg wrapper, not issuer-native.
        </p>
      )}
    </div>
  );
}

function QuoteBreakdown({
  quote,
  rate,
  chain,
}: {
  quote: SwapQuote;
  rate: number | null;
  chain: ChainId;
}) {
  return (
    <Card>
      <SectionTitle title="Quote" hint={`via ${quote.provider}`} />
      <dl className="space-y-2.5 text-xs">
        {rate !== null && (
          <Row label="Rate">
            1 {quote.sell.symbol} ≈ {rate.toLocaleString('en-US', { maximumFractionDigits: 6 })}{' '}
            {quote.buy.symbol}
          </Row>
        )}
        <Row label="Minimum received">
          {formatUnits(quote.minBuyRaw, quote.buy.decimals, 6)} {quote.buy.symbol}
        </Row>
        {quote.priceImpactPct !== undefined && (
          <Row label="Price impact">
            <span className={quote.priceImpactPct > 1 ? 'text-amber' : undefined}>
              {quote.priceImpactPct.toFixed(3)}%
            </span>
          </Row>
        )}
        {quote.gasRaw !== undefined && (
          <Row label="Network fee">
            ~{formatUnits(quote.gasRaw, 18, 6)} {CHAIN_METAS[chain].symbol}
          </Row>
        )}
        <div className="border-t border-edge pt-2.5">
          <Row label={`App fee (${(quote.fee.bps / 100).toFixed(2)}%)`}>
            {quote.fee.applied ? (
              <span className="text-slate-200">
                {formatUnits(quote.fee.raw, quote.fee.asset.decimals, 6)} {quote.fee.asset.symbol}
              </span>
            ) : (
              <span className="text-dim">not applied</span>
            )}
          </Row>
        </div>
        {!quote.fee.applied && quote.fee.reason && (
          <p className="text-[11px] leading-relaxed text-dim">{quote.fee.reason}</p>
        )}
      </dl>
    </Card>
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
