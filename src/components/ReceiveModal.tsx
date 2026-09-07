'use client';

import * as React from 'react';
import QRCode from 'qrcode';

import type { DerivedAccount } from '@/lib/chains/types';
import { CHAIN_METAS } from '@/lib/chains/meta';
import { Alert, CopyButton, Modal, Skeleton } from './ui';

export default function ReceiveModal({
  account,
  onClose,
}: {
  account: DerivedAccount | null;
  onClose: () => void;
}) {
  const [qr, setQr] = React.useState<string | null>(null);
  const [which, setWhich] = React.useState<'primary' | 'alt'>('primary');

  const address =
    which === 'alt' && account?.altAddress ? account.altAddress.address : account?.address;

  React.useEffect(() => {
    let cancelled = false;
    setQr(null);
    if (!address) return;

    void QRCode.toDataURL(address, {
      width: 512,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#e8ecf3', light: '#0c1017' },
    }).then((url) => {
      if (!cancelled) setQr(url);
    });

    return () => {
      cancelled = true;
    };
  }, [address]);

  const meta = account ? CHAIN_METAS[account.chain] : null;

  return (
    <Modal open={Boolean(account)} onClose={onClose} title={meta ? `Receive ${meta.symbol}` : 'Receive'}>
      {account && meta && address && (
        <div className="space-y-4">
          {account.altAddress && (
            <div className="flex rounded-lg border border-edge bg-panel p-0.5 text-xs">
              <button
                onClick={() => setWhich('primary')}
                className={`flex-1 rounded-md px-3 py-1.5 ${which === 'primary' ? 'bg-panel-2 text-slate-50' : 'text-muted'}`}
              >
                Native SegWit
              </button>
              <button
                onClick={() => setWhich('alt')}
                className={`flex-1 rounded-md px-3 py-1.5 ${which === 'alt' ? 'bg-panel-2 text-slate-50' : 'text-muted'}`}
              >
                Taproot
              </button>
            </div>
          )}

          <div className="flex justify-center">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr}
                alt={`QR code for ${address}`}
                className="size-52 rounded-xl border border-edge"
              />
            ) : (
              <Skeleton className="size-52 rounded-xl" />
            )}
          </div>

          <div className="rounded-xl border border-edge bg-void p-3">
            <p className="font-mono text-xs leading-relaxed break-all text-slate-100">{address}</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="font-mono text-[10px] text-dim">
                {which === 'alt' && account.altAddress
                  ? account.altAddress.derivationPath
                  : account.derivationPath}
              </span>
              <CopyButton value={address} label="Copy address" />
            </div>
          </div>

          <Alert tone="amber">
            Only send {meta.symbol} on {meta.name} to this address. Coins sent from a different chain
            or a wrapped/bridged version of {meta.symbol} will be lost.
          </Alert>
        </div>
      )}
    </Modal>
  );
}
