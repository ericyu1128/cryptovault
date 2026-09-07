'use client';

import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info' | 'pending';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
  link?: { href: string; label: string };
  /** ms; 0 keeps it until dismissed (used for pending transactions). */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => string;
  update: (id: string, patch: Partial<Omit<Toast, 'id'>>) => void;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],

  push: (toast) => {
    const id = crypto.randomUUID();
    const duration = toast.duration ?? (toast.kind === 'pending' ? 0 : 7000);
    set((s) => ({ toasts: [...s.toasts, { ...toast, id, duration }] }));
    if (duration > 0) window.setTimeout(() => get().dismiss(id), duration);
    return id;
  },

  update: (id, patch) => {
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    const next = get().toasts.find((t) => t.id === id);
    if (next && next.duration > 0) window.setTimeout(() => get().dismiss(id), next.duration);
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
