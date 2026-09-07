'use client';

import * as React from 'react';

import { EVM } from '@/lib/chains/networks';
import { classNames, formatUnits, shortAddress } from '@/lib/format';
import { useToasts } from '@/state/toastStore';
import { useWallet } from '@/state/walletStore';
import type { DeployQuote } from '@/lib/contracts/deploy';
import { Alert, Badge, Button, Card, CopyButton, Input, Label, Modal, SectionTitle } from '../ui';

export default function DeployTab() {
  const seed = useWallet((s) => s.seed);
  const settings = useWallet((s) => s.settings);
  const account = useWallet((s) => s.accounts.ethereum);
  const balance = useWallet((s) => s.balances.ethereum);
  const recordDeployment = useWallet((s) => s.recordDeployment);
  const addTrackedToken = useWallet((s) => s.addTrackedToken);
  const refreshBalances = useWallet((s) => s.refreshBalances);
  const push = useToasts((s) => s.push);
  const update = useToasts((s) => s.update);

  const [name, setName] = React.useState('');
  const [symbol, setSymbol] = React.useState('');
  const [decimals, setDecimals] = React.useState('18');
  const [supply, setSupply] = React.useState('1000000');
  const [owner, setOwner] = React.useState('');

  const [quote, setQuote] = React.useState<DeployQuote | null>(null);
  const [quoting, setQuoting] = React.useState(false);
  const [deploying, setDeploying] = React.useState(false);
  const [compilerVersion, setCompilerVersion] = React.useState('');
  const [confirm, setConfirm] = React.useState(false);

  React.useEffect(() => {
    void import('@/lib/contracts/erc20').then((m) => setCompilerVersion(m.ERC20_COMPILER_VERSION));
  }, []);

  const net = EVM[settings.mode];
  const decimalsNum = Number(decimals);

  const validation = React.useMemo(() => {
    const problems: string[] = [];
    if (name.trim().length === 0) problems.push('Token name is required');
    if (!/^[A-Za-z0-9]{2,11}$/.test(symbol.trim())) problems.push('Symbol must be 2-11 letters/digits');
    if (!Number.isInteger(decimalsNum) || decimalsNum < 0 || decimalsNum > 18)
      problems.push('Decimals must be 0-18');
    if (!/^\d+$/.test(supply.replace(/[,_\s]/g, ''))) problems.push('Supply must be a whole number');
    return problems;
  }, [name, symbol, decimalsNum, supply]);

  const ready = validation.length === 0 && Boolean(seed) && Boolean(account);

  async function handleQuote() {
    if (!seed || !ready) return;
    setQuoting(true);
    setQuote(null);
    try {
      const { quoteDeployment } = await import('@/lib/contracts/deploy');
      const q = await quoteDeployment({
        seed,
        accountIndex: settings.accountIndex,
        mode: settings.mode,
        name,
        symbol,
        decimals: decimalsNum,
        totalSupply: supply,
        owner: owner.trim() || undefined,
      });
      setQuote(q);
      if (!q.sufficient) {
        push({
          kind: 'error',
          title: 'Not enough ETH for gas',
          body: `Deployment costs about ${formatUnits(q.costWei, 18, 6)} ETH; this account holds ${formatUnits(q.balanceWei, 18, 6)} ETH.`,
        });
      }
    } catch (err) {
      push({
        kind: 'error',
        title: 'Could not estimate the deployment',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setQuoting(false);
    }
  }

  async function handleDeploy() {
    if (!seed) return;
    setConfirm(false);
    setDeploying(true);

    const toastId = push({
      kind: 'pending',
      title: `Deploying ${symbol.toUpperCase()}`,
      body: `Broadcasting to ${net.name} and waiting for one confirmation…`,
    });

    try {
      const { deployErc20 } = await import('@/lib/contracts/deploy');
      const result = await deployErc20({
        seed,
        accountIndex: settings.accountIndex,
        mode: settings.mode,
        name,
        symbol,
        decimals: decimalsNum,
        totalSupply: supply,
        owner: owner.trim() || undefined,
      });

      recordDeployment({
        contractAddress: result.contractAddress,
        txHash: result.txHash,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        decimals: decimalsNum,
        totalSupply: supply,
        mode: settings.mode,
        chainId: net.chainId,
        deployedAt: Date.now(),
        explorerAddress: result.explorerAddress,
      });

      addTrackedToken({
        address: result.contractAddress,
        mode: settings.mode,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        decimals: decimalsNum,
      });

      update(toastId, {
        kind: 'success',
        title: `${symbol.toUpperCase()} is live`,
        body: result.contractAddress,
        link: { href: result.explorerAddress, label: 'View token on the explorer' },
        duration: 20000,
      });

      setQuote(null);
      window.setTimeout(() => void refreshBalances(), 3000);
    } catch (err) {
      update(toastId, {
        kind: 'error',
        title: 'Deployment failed',
        body: err instanceof Error ? err.message : String(err),
        duration: 20000,
      });
    } finally {
      setDeploying(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <SectionTitle
          title="Deploy an ERC-20"
          hint="OpenZeppelin ERC20 + Burnable + Permit + Ownable, compiled ahead of time and deployed straight from your key."
          right={
            <Badge tone={settings.mode === 'testnet' ? 'violet' : 'amber'}>{net.name}</Badge>
          }
        />

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="tname">Token name</Label>
              <Input
                id="tname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Vault Reward Token"
                maxLength={64}
              />
            </div>
            <div>
              <Label htmlFor="tsym">Symbol</Label>
              <Input
                id="tsym"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="VRT"
                maxLength={11}
                className="font-mono"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="tdec">Decimals</Label>
              <Input
                id="tdec"
                value={decimals}
                onChange={(e) => setDecimals(e.target.value.replace(/\D/g, '').slice(0, 2))}
                inputMode="numeric"
                className="tnum"
              />
              <p className="mt-1.5 text-[11px] text-dim">18 matches ETH and almost every DeFi tool.</p>
            </div>
            <div>
              <Label htmlFor="tsup">Initial supply (whole tokens)</Label>
              <Input
                id="tsup"
                value={supply}
                onChange={(e) => setSupply(e.target.value.replace(/[^\d,_\s]/g, ''))}
                inputMode="numeric"
                className="tnum"
              />
              <p className="mt-1.5 text-[11px] text-dim">
                Minted to the owner as {supply.replace(/[,_\s]/g, '') || '0'} × 10^{decimals || '0'}.
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="towner">Owner (optional)</Label>
            <Input
              id="towner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder={account?.address ?? '0x…'}
              spellCheck={false}
              className="font-mono text-xs"
            />
            <p className="mt-1.5 text-[11px] text-dim">
              Receives the whole initial supply and can mint more until <code className="font-mono">finishMinting()</code> is called. Defaults to your account.
            </p>
          </div>

          {validation.length > 0 && (
            <ul className="space-y-1 text-[11px] text-rose">
              {validation.map((p) => (
                <li key={p}>· {p}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void handleQuote()} loading={quoting} disabled={!ready}>
              Estimate gas
            </Button>
            <Button
              variant="primary"
              onClick={() => setConfirm(true)}
              loading={deploying}
              disabled={!ready || !quote?.sufficient}
            >
              Deploy contract
            </Button>
          </div>

          {quote && (
            <div className="rounded-xl border border-edge bg-void p-4 text-xs">
              <dl className="space-y-2">
                <QuoteRow label="Gas limit (with 20% headroom)">{quote.gasLimit.toLocaleString()}</QuoteRow>
                <QuoteRow label="Gas price">{formatUnits(quote.gasPriceWei, 9, 4)} gwei</QuoteRow>
                <QuoteRow label="Estimated cost">{formatUnits(quote.costWei, 18, 8)} ETH</QuoteRow>
                <QuoteRow label="Your balance">
                  <span className={classNames(quote.sufficient ? 'text-mint' : 'text-rose')}>
                    {formatUnits(quote.balanceWei, 18, 8)} ETH
                  </span>
                </QuoteRow>
              </dl>
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-5">
        <Card>
          <SectionTitle title="What gets deployed" />
          <ul className="space-y-2 text-xs text-muted">
            <Feature>Standard <code className="font-mono text-slate-200">ERC20</code> transfer/approve semantics from OpenZeppelin 5.x</Feature>
            <Feature><code className="font-mono text-slate-200">ERC20Burnable</code> — holders can burn their own balance</Feature>
            <Feature><code className="font-mono text-slate-200">ERC20Permit</code> (EIP-2612) — gasless approvals via signature</Feature>
            <Feature><code className="font-mono text-slate-200">Ownable</code> mint, permanently disabled by <code className="font-mono text-slate-200">finishMinting()</code></Feature>
            <Feature>No pause, no blocklist, no transfer tax, no proxy — nothing that reads as a honeypot</Feature>
          </ul>
          {compilerVersion && (
            <p className="mt-4 border-t border-edge pt-3 font-mono text-[10px] text-dim">
              solc {compilerVersion} · optimizer 200 runs · source in contracts/CryptoVaultToken.sol
            </p>
          )}
        </Card>

        {settings.mode === 'mainnet' ? (
          <Alert tone="rose" title="You are deploying to Ethereum mainnet">
            This costs real ETH and the contract is permanent. Deploy to Sepolia first and confirm the
            token behaves the way you expect.
          </Alert>
        ) : (
          <Alert tone="violet" title="Sepolia testnet">
            Free to deploy. Grab test ETH from a faucet, deploy, then add the contract address to any
            wallet to see the token appear.
          </Alert>
        )}

        {balance && balance.raw === 0n && (
          <Alert tone="amber">
            This account holds 0 ETH on {net.name}, so no deployment can be paid for yet.
            {net.faucet && (
              <>
                {' '}
                <a href={net.faucet} target="_blank" rel="noreferrer noopener" className="underline">
                  Open a faucet ↗
                </a>
              </>
            )}
          </Alert>
        )}

        <DeploymentHistory />
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Deploy this token?">
        <div className="space-y-4">
          <dl className="space-y-2.5 text-xs">
            <QuoteRow label="Name">{name}</QuoteRow>
            <QuoteRow label="Symbol">{symbol.toUpperCase()}</QuoteRow>
            <QuoteRow label="Decimals">{decimals}</QuoteRow>
            <QuoteRow label="Initial supply">
              {supply.replace(/[,_\s]/g, '')} {symbol.toUpperCase()}
            </QuoteRow>
            <QuoteRow label="Owner">
              <span className="font-mono">{shortAddress(owner.trim() || account?.address || '', 10, 8)}</span>
            </QuoteRow>
            <QuoteRow label="Network">{net.name}</QuoteRow>
            {quote && <QuoteRow label="Est. cost">{formatUnits(quote.costWei, 18, 8)} ETH</QuoteRow>}
          </dl>

          <Alert tone={settings.mode === 'mainnet' ? 'rose' : 'amber'}>
            Contracts are immutable. Once this is mined the name, symbol and decimals can never be
            changed — you would have to deploy a new token.
          </Alert>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleDeploy()}>
              Sign &amp; deploy
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function QuoteRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-dim">{label}</dt>
      <dd className="tnum min-w-0 text-right text-slate-200">{children}</dd>
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <svg viewBox="0 0 20 20" className="mt-0.5 size-3.5 shrink-0 text-mint" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 10.5 8 14.5 16 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

function DeploymentHistory() {
  const deployments = useWallet((s) => s.settings.deployments);
  if (deployments.length === 0) return null;

  return (
    <Card>
      <SectionTitle title="Your deployments" hint="Stored locally in this browser." />
      <ul className="divide-y divide-edge-soft">
        {deployments.map((d) => (
          <li key={d.txHash} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-100">
                  {d.name} <span className="text-dim">({d.symbol})</span>
                </p>
                <p className="font-mono text-[11px] text-dim">{shortAddress(d.contractAddress, 10, 8)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Badge tone={d.mode === 'testnet' ? 'violet' : 'amber'}>{d.mode}</Badge>
                <CopyButton value={d.contractAddress} label="" />
                <a
                  href={d.explorerAddress}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-lg px-1.5 py-1 text-dim transition-colors hover:text-slate-100"
                  aria-label="Open in explorer"
                >
                  <svg viewBox="0 0 20 20" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M7 13 13 7M8 7h5v5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
