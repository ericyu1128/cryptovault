import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';

/**
 * SLIP-0010 hierarchical derivation over the ed25519 curve.
 *
 * Used by Solana (m/44'/501'/…) and TON (m/44'/607'/…). ed25519 has no public
 * child derivation, so every path segment MUST be hardened - we enforce that
 * rather than silently hardening for the caller, because a silent fixup would
 * produce addresses that differ from other wallets using the same phrase.
 */
const ED25519_SEED_KEY = new TextEncoder().encode('ed25519 seed');
const HARDENED_OFFSET = 0x80000000;

export interface Slip10Node {
  key: Uint8Array; // 32-byte ed25519 seed for this node
  chainCode: Uint8Array;
}

export function slip10DeriveEd25519(path: string, seed: Uint8Array): Slip10Node {
  if (seed.length < 16) throw new Error('SLIP-0010: seed too short');

  let I = hmac(sha512, ED25519_SEED_KEY, seed);
  let key = I.slice(0, 32);
  let chainCode = I.slice(32);

  const trimmed = path.trim();
  if (!/^m(\/\d+'?)*$/.test(trimmed)) throw new Error(`SLIP-0010: malformed path "${path}"`);

  const segments = trimmed.split('/').slice(1);
  for (const segment of segments) {
    if (!segment.endsWith("'")) {
      throw new Error(`SLIP-0010 (ed25519) requires hardened segments; got "${segment}" in "${path}"`);
    }
    const index = Number.parseInt(segment.slice(0, -1), 10);
    if (!Number.isSafeInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
      throw new Error(`SLIP-0010: index out of range in "${path}"`);
    }

    // data = 0x00 || key || ser32(index + 2^31)
    const data = new Uint8Array(37);
    data[0] = 0x00;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, (index + HARDENED_OFFSET) >>> 0, false);

    I = hmac(sha512, chainCode, data);
    key = I.slice(0, 32);
    chainCode = I.slice(32);
  }

  return { key, chainCode };
}
