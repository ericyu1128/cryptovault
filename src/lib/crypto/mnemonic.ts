import {
  generateMnemonic as bip39Generate,
  mnemonicToSeedSync,
  validateMnemonic as bip39Validate,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

export type MnemonicStrength = 128 | 256; // 12 or 24 words

/** Generate a fresh BIP-39 phrase using the platform CSPRNG. */
export function generateMnemonic(strength: MnemonicStrength = 128): string {
  return bip39Generate(wordlist, strength);
}

export function validateMnemonic(phrase: string): boolean {
  return bip39Validate(normalizeMnemonic(phrase), wordlist);
}

/** BIP-39 phrases are whitespace/case normalised and NFKD-folded before use. */
export function normalizeMnemonic(phrase: string): string {
  return phrase.normalize('NFKD').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * BIP-39 seed. The optional passphrase is the BIP-39 "25th word" - it produces a
 * completely different wallet and is NOT recoverable from the phrase alone.
 */
export function mnemonicToSeed(phrase: string, passphrase = ''): Uint8Array {
  return mnemonicToSeedSync(normalizeMnemonic(phrase), passphrase);
}

/** Words that are in the wordlist, for the import screen's live validation. */
export function invalidWords(phrase: string): string[] {
  const set = new Set(wordlist);
  return normalizeMnemonic(phrase)
    .split(' ')
    .filter((w) => w.length > 0 && !set.has(w));
}

export { wordlist as englishWordlist };
