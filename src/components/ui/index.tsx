'use client';

import * as React from 'react';
import { classNames, copyToClipboard } from '@/lib/format';

/* --------------------------------------------------------------- primitives */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-mint text-void hover:bg-[color-mix(in_oklab,var(--color-mint)_88%,white)] disabled:hover:bg-mint font-semibold',
  secondary: 'bg-panel-2 text-slate-100 border border-edge hover:border-slate-500',
  ghost: 'text-muted hover:text-slate-100 hover:bg-panel-2',
  danger: 'bg-rose/12 text-rose border border-rose/35 hover:bg-rose/20',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-lg',
  md: 'h-10 px-4 text-sm rounded-xl',
  lg: 'h-12 px-6 text-sm rounded-xl',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={classNames(
        'inline-flex items-center justify-center gap-2 transition-colors select-none',
        'disabled:opacity-45 disabled:cursor-not-allowed',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={classNames('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={classNames('panel p-5', className)}>
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  hint,
  right,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">{title}</h2>
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted">
      {children}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} {...rest} className={classNames('field', className)} />;
  },
);

export function Textarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={classNames('field resize-none', className)} />;
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={classNames('field appearance-none pr-8', className)}>
      {children}
    </select>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'mint' | 'amber' | 'rose' | 'violet';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-panel-2 text-muted border-edge',
    mint: 'bg-mint/10 text-mint border-mint/30',
    amber: 'bg-amber/10 text-amber border-amber/30',
    rose: 'bg-rose/10 text-rose border-rose/30',
    violet: 'bg-violet/10 text-violet border-violet/30',
  } as const;
  return (
    <span
      className={classNames(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------- alerts */

export function Alert({
  tone = 'amber',
  title,
  children,
  className,
}: {
  tone?: 'amber' | 'rose' | 'mint' | 'violet';
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    amber: 'border-amber/30 bg-amber/8 text-amber',
    rose: 'border-rose/30 bg-rose/8 text-rose',
    mint: 'border-mint/30 bg-mint/8 text-mint',
    violet: 'border-violet/30 bg-violet/8 text-violet',
  } as const;
  return (
    <div className={classNames('rounded-xl border p-3.5 text-xs leading-relaxed', tones[tone], className)}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div className="text-slate-300/90">{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------- copy button */

export function CopyButton({
  value,
  label = 'Copy',
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyToClipboard(value)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }
      }}
      className={classNames(
        'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-muted transition-colors hover:bg-panel-2 hover:text-slate-100',
        className,
      )}
      aria-label={`${label}: ${value}`}
    >
      {copied ? (
        <svg viewBox="0 0 20 20" className="size-3.5 text-mint" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 10.5 8 14.5 16 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="7" y="7" width="9" height="9" rx="2" />
          <path d="M13 5.5A2.5 2.5 0 0 0 10.5 3h-5A2.5 2.5 0 0 0 3 5.5v5A2.5 2.5 0 0 0 5.5 13" />
        </svg>
      )}
      {copied ? 'Copied' : label}
    </button>
  );
}

/* --------------------------------------------------------------------- modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={classNames(
          'panel animate-rise relative w-full overflow-hidden rounded-b-none sm:rounded-2xl',
          maxWidth,
        )}
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-dim transition-colors hover:bg-panel-2 hover:text-slate-100"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ skeleton */

export function Skeleton({ className }: { className?: string }) {
  return <div className={classNames('skeleton rounded-md', className)} />;
}
