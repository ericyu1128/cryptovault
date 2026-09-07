'use client';

import * as React from 'react';

import { CHAIN_METAS } from '@/lib/chains/meta';
import { tokensFor } from '@/lib/chains/tokens';
import type { ChainId, NetworkMode, TokenBalance } from '@/lib/chains/types';
import { formatUnits, shortAddress } from '@/lib/format';
import { useToasts } from '@/state/toastStore';
import { useWallet } from '@/state/walletStore';
import { Alert, Badge, Button, Card, CopyButton, Input, SectionTitle, Skeleton } from './ui';

/** Chains whose non-native assets we display. */
const TOKEN_CHAINS: ChainId[] = ['ethereum', 'bsc', 'solana'];

interface Row extends TokenBalance {
  chain: ChainId;
  bridged?: boolean;
  error?: string;
}

async function loadChainTokens(
  chain: ChainId,
  mode: NetworkMode,
  owner: string,
  extraEvmAddresses: string[],
): Promise<Row[]> {
  if (chain === 'solana') {
    const { fetchSplTokens } = await import('@/lib/chains/solana');
    const balances = await fetchSplTokens(owner, mode);
    const registry = tokensFor('solana', mode);
    return balances.map((b) => ({
      ...b,
      chain,
      bridged: registry.find((r) => r.address === b.address)?.bridged,
    }));
  }

  if (chain !== 'ethereum' && chain !== 'bsc') return [];

  const { fetchTokenBalanceOn } = await import('@/lib/chains/evm');
  const registry = tokensFor(chain, mode);
  const addresses = [
    ...registry.map((t) => t.address),
    ...extraEvmAddresses.filter(
      (a) => !registry.some((r) => r.address.toLowerCase() === a.toLowerCase()),
    ),
  ];

  const settled = await Promise.allSettled(
    addresses.map((address) => fetchTokenBalanceOn(address, owner, chain, mode)),
  );

  return settled.map((r, i): Row =>
    r.status === 'fulfilled'
      ? {
          ...r.value,
          chain,
          bridged: registry.find((t) => t.address === addresses[i])?.bridged,
        }
      : {
          address: addresses[i],
          name: addresses[i],
          symbol: '???',
          decimals: 18,
          raw: 0n,
          chain,
          error: r.reason instanceof Error ? r.reason.message : 'Read failed',
        },
  );
}

/**
 * Token holdings across every chain that has them. Stablecoins come from the
 * verified registry; anything else is a contract the user chose to track.
 */
export default function TokenList() {
  const mode = useWallet((s) => s.settings.mode);
  const tracked = useWallet((s) => s.settings.trackedTokens);
  const accounts = useWallet((s) => s.accounts);
  const addTrackedToken = useWallet((s) => s.addTrackedToken);
  const removeTrackedToken = useWallet((s) => s.removeTrackedToken);
  const hideBalances = useWallet((s) => s.settings.hideBalances);
  const push = useToasts((s) => s.push);

  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [draft, setDraft] = React.useState('');
  const [adding, setAdding] = React.useState(false);

  const extraEvm = React.useMemo(
    () => tracked.filter((t) => t.mode === mode).map((t) => t.address),
    [tracked, mode],
  );

  React.useEffect(() => {
    let cancelled = false;
    setRows(null);

    void (async () => {
      const chains = TOKEN_CHAINS.filter((c) => accounts[c]);
      const results = await Promise.all(
        chains.map((chain) =>
          loadChainTokens(chain, mode, accounts[chain]!.address, extraEvm).catch(() => [] as Row[]),
        ),
      );
      if (!cancelled) setRows(results.flat());
    })();

    return () => {
      cancelled = true;
    };
  }, [accounts, mode, extraEvm]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const address = draft.trim();
    if (!address) return;
    const owner = accounts.ethereum;
    if (!owner) return;

    setAdding(true);
    try {
      const [{ fetchTokenBalanceOn }, { isAddress }] = await Promise.all([
        import('@/lib/chains/evm'),
        import('ethers'),
      ]);
      if (!isAddress(address)) throw new Error('That is not a valid contract address');

      const info = await fetchTokenBalanceOn(address, owner.address, 'ethereum', mode);
      addTrackedToken({ address, mode, name: info.name, symbol: info.symbol, decimals: info.decimals });
      setDraft('');
      push({ kind: 'success', title: `Tracking ${info.symbol}`, body: info.name });
    } catch (err) {
      push({
        kind: 'error',
        title: 'Could not read that token',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAdding(false);
    }
  }

  const visible = (rows ?? []).filter((r) => r.raw > 0n || r.error || tracked.some((t) => t.address === r.address));

  return (
    <Card>
      <SectionTitle
        title="Tokens"
        hint="USDT and USDC come from a registry verified against Circle and Tether. Deployed tokens are added automatically."
      />

      {rows === null ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : visible.length === 0 ? (
        <Alert tone="violet">
          No token balances on {mode}. Stablecoin addresses are pre-loaded for Ethereum, BNB Smart
          Chain and Solana — they appear here as soon as you hold any.
        </Alert>
      ) : (
        <ul className="divide-y divide-edge-soft">
          {visible.map((token) => {
            const meta = CHAIN_METAS[token.chain];
            return (
              <li key={`${token.chain}:${token.address}`} className="flex items-center gap-3 py-3">
                <div
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-[10px] font-bold"
                  style={{ backgroundColor: `${meta.accent}1f`, color: meta.accent }}
                >
                  {token.symbol.slice(0, 4).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm text-slate-100">{token.name}</p>
                    {token.bridged && <Badge tone="amber">bridged</Badge>}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-dim">{meta.name}</span>
                    <span className="text-dim">·</span>
                    <span className="font-mono text-[11px] text-dim">
                      {shortAddress(token.address, 6, 5)}
                    </span>
                    <CopyButton value={token.address} label="" className="px-1" />
                  </div>
                </div>
                <div className="text-right">
                  {token.error ? (
                    <Badge tone="rose">{token.error.slice(0, 30)}</Badge>
                  ) : (
                    <p className="tnum text-sm text-slate-50">
                      {hideBalances ? '••••' : `${formatUnits(token.raw, token.decimals, 6)} ${token.symbol}`}
                    </p>
                  )}
                  <p className="text-[10px] text-dim">{token.decimals} decimals</p>
                </div>
                {tracked.some((t) => t.address.toLowerCase() === token.address.toLowerCase()) && (
                  <button
                    onClick={() => removeTrackedToken(token.address, mode)}
                    className="rounded-lg p-1.5 text-dim transition-colors hover:bg-panel-2 hover:text-rose"
                    aria-label={`Stop tracking ${token.symbol}`}
                  >
                    <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={handleAdd} className="mt-4 flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="0x… track another Ethereum ERC-20"
          className="font-mono text-xs"
          spellCheck={false}
        />
        <Button type="submit" loading={adding} disabled={draft.trim().length === 0}>
          Track
        </Button>
      </form>
    </Card>
  );
}
