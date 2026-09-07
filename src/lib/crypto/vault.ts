/**
 * Encrypted-at-rest storage for the master seed phrase.
 *
 * Threat model this actually defends against: someone who can read
 * localStorage (a stolen laptop, a backup, devtools on an unlocked machine)
 * cannot recover the phrase without the password.
 *
 * What it does NOT defend against: malicious JavaScript running in this origin
 * while the wallet is unlocked. That is why the decrypted phrase lives only in
 * a module-scoped variable, is never written back to storage, and is wiped on
 * lock / auto-lock / tab close.
 *
 * Crypto: PBKDF2-HMAC-SHA256 (600k iterations, OWASP 2023+ guidance) -> 256-bit
 * AES-GCM key. Random 16-byte salt and 12-byte IV per encryption.
 */

const VAULT_KEY = 'cryptovault.vault.v1';
const META_KEY = 'cryptovault.meta.v1';

export const PBKDF2_ITERATIONS = 600_000;

export interface EncryptedVault {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64 (includes GCM tag)
  createdAt: number;
}

export interface VaultMeta {
  /** Set once the user has confirmed they wrote the phrase down. */
  backedUp: boolean;
  /** Minutes of inactivity before the in-memory phrase is wiped. 0 = never. */
  autoLockMinutes: number;
  createdAt: number;
}

/* ---------------------------------------------------------------- encoding */

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------- crypto */

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptVault(plaintext: string, password: string): Promise<EncryptedVault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(plaintext)),
  );
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(ct),
    createdAt: Date.now(),
  };
}

export async function decryptVault(vault: EncryptedVault, password: string): Promise<string> {
  const key = await deriveKey(password, fromB64(vault.salt), vault.iterations);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(vault.iv) as BufferSource },
      key,
      fromB64(vault.ciphertext) as BufferSource,
    );
    return dec.decode(pt);
  } catch {
    // AES-GCM authentication failure - wrong password or tampered ciphertext.
    throw new Error('Incorrect password');
  }
}

/* ------------------------------------------------------------------ storage */

export function loadVault(): EncryptedVault | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(VAULT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EncryptedVault;
    return parsed?.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function saveVault(vault: EncryptedVault): void {
  window.localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
}

export function hasVault(): boolean {
  return loadVault() !== null;
}

export function destroyVault(): void {
  window.localStorage.removeItem(VAULT_KEY);
  window.localStorage.removeItem(META_KEY);
}

const DEFAULT_META: VaultMeta = { backedUp: false, autoLockMinutes: 15, createdAt: 0 };

export function loadMeta(): VaultMeta {
  if (typeof window === 'undefined') return DEFAULT_META;
  try {
    const raw = window.localStorage.getItem(META_KEY);
    return raw ? { ...DEFAULT_META, ...(JSON.parse(raw) as Partial<VaultMeta>) } : DEFAULT_META;
  } catch {
    return DEFAULT_META;
  }
}

export function saveMeta(meta: Partial<VaultMeta>): VaultMeta {
  const next = { ...loadMeta(), ...meta };
  window.localStorage.setItem(META_KEY, JSON.stringify(next));
  return next;
}

/* ------------------------------------------------------- password strength */

export interface PasswordScore {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  problems: string[];
}

export function scorePassword(pw: string): PasswordScore {
  const problems: string[] = [];
  if (pw.length < 12) problems.push('Use at least 12 characters');
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) problems.push('Mix upper and lower case');
  if (!/\d/.test(pw)) problems.push('Add a number');
  if (!/[^A-Za-z0-9]/.test(pw)) problems.push('Add a symbol');

  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw) && pw.length >= 12) score++;

  const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;
  const clamped = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
  return { score: clamped, label: labels[clamped], problems };
}
