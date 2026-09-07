'use client';

// Must be first: installs the Buffer/process globals the chain SDKs expect.
import '@/lib/polyfills';

import * as React from 'react';

import { useWallet } from '@/state/walletStore';
import Dashboard from './Dashboard';
import ToastViewport from './ToastViewport';
import WalletGate from './WalletGate';
import { Spinner } from './ui';

export default function App() {
  const status = useWallet((s) => s.status);
  const onboarding = useWallet((s) => s.onboarding);
  const boot = useWallet((s) => s.boot);

  React.useEffect(() => {
    boot();
  }, [boot]);

  useAutoLock();

  return (
    <>
      {status === 'booting' ? (
        <div className="grid min-h-dvh place-items-center">
          <Spinner className="size-6 text-mint" />
        </div>
      ) : status === 'unlocked' && !onboarding ? (
        <Dashboard />
      ) : (
        <WalletGate />
      )}
      <ToastViewport />
    </>
  );
}

/**
 * Wipes the in-memory phrase after a period of inactivity. Cheap, but it closes
 * the most common real-world hole: an unlocked wallet left open on a shared or
 * unattended machine.
 */
function useAutoLock() {
  const status = useWallet((s) => s.status);
  const minutes = useWallet((s) => s.settings.autoLockMinutes);
  const touch = useWallet((s) => s.touch);
  const lock = useWallet((s) => s.lock);

  React.useEffect(() => {
    if (status !== 'unlocked' || minutes <= 0) return;

    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
      touch();
    };
    for (const e of events) window.addEventListener(e, bump, { passive: true });

    const timer = window.setInterval(() => {
      if (Date.now() - last > minutes * 60_000) lock();
    }, 15_000);

    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      window.clearInterval(timer);
    };
  }, [status, minutes, touch, lock]);
}
