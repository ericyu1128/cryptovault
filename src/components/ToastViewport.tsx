'use client';

import { useToasts, type ToastKind } from '@/state/toastStore';
import { classNames } from '@/lib/format';
import { Spinner } from './ui';

const TONE: Record<ToastKind, { ring: string; icon: React.ReactNode }> = {
  success: {
    ring: 'border-mint/35',
    icon: (
      <svg viewBox="0 0 20 20" className="size-4 text-mint" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 10.5 8 14.5 16 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  error: {
    ring: 'border-rose/40',
    icon: (
      <svg viewBox="0 0 20 20" className="size-4 text-rose" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 6v5M10 14h.01" strokeLinecap="round" />
        <circle cx="10" cy="10" r="8" strokeWidth="1.5" />
      </svg>
    ),
  },
  info: {
    ring: 'border-violet/35',
    icon: (
      <svg viewBox="0 0 20 20" className="size-4 text-violet" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 9v5M10 6h.01" strokeLinecap="round" />
        <circle cx="10" cy="10" r="8" strokeWidth="1.5" />
      </svg>
    ),
  },
  pending: { ring: 'border-amber/35', icon: <Spinner className="size-4 text-amber" /> },
};

export default function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={classNames(
            'panel animate-rise pointer-events-auto flex w-full max-w-sm gap-3 p-3.5 shadow-2xl shadow-black/60',
            TONE[t.kind].ring,
          )}
        >
          <div className="mt-0.5 shrink-0">{TONE[t.kind].icon}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-100">{t.title}</p>
            {t.body && <p className="mt-0.5 text-xs break-words text-muted">{t.body}</p>}
            {t.link && (
              <a
                href={t.link.href}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-mint hover:underline"
              >
                {t.link.label}
                <svg viewBox="0 0 20 20" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M7 13 13 7M8 7h5v5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
          </div>
          <button
            onClick={() => dismiss(t.id)}
            className="-mt-1 -mr-1 h-6 w-6 shrink-0 rounded-md text-dim transition-colors hover:bg-panel-2 hover:text-slate-100"
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 20 20" className="mx-auto size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
