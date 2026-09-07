import { MONERO_META } from './meta';
import type { ChainAdapter } from './types';

export { MONERO_META };

/**
 * Monero placeholder.
 *
 * This file exists so XMR has a real drop-in point that already satisfies the
 * ChainAdapter contract. It is intentionally not wired into CHAIN_ORDER, so
 * nothing in the UI can call it today.
 *
 * Why Monero cannot reuse any existing code path here:
 *
 *  - Keys. Monero is CryptoNote, not BIP-32. An account is a *pair* of Ed25519
 *    keypairs (spend and view) derived by reducing a 32-byte seed mod l, and
 *    the address is base58-monero over (network byte ‖ spend pub ‖ view pub ‖
 *    keccak checksum). None of @scure/bip32, SLIP-0010 or our address encoders
 *    apply.
 *
 *  - Balances. There is no "get balance of address" call, because there are no
 *    accounts. A wallet must pull every block and trial-decrypt each output
 *    with its private view key. That is either a full local node, or handing
 *    the view key to a third-party light-wallet server - which lets that server
 *    see every payment you ever receive, forever.
 *
 *  - Spending. Requires building ring signatures and bulletproofs. In a browser
 *    that means the ~15 MB monero-ts WASM bundle plus a trusted remote node.
 *
 * To implement it, replace the throws below. Receive-only support (derivation
 * plus address display) is self-contained and verifiable against the published
 * CryptoNote test vectors; balances and sending are what pull in a server
 * dependency and break this app's zero-backend property.
 */
const NOT_IMPLEMENTED =
  'Monero support is not implemented. See src/lib/chains/monero.ts for what it requires.';

function unavailable(): never {
  throw new Error(NOT_IMPLEMENTED);
}

export const moneroAdapter: ChainAdapter = {
  meta: MONERO_META,
  derive: unavailable,
  getBalance: unavailable,
  estimateFee: unavailable,
  send: unavailable,
  validateAddress: () => false,
  explorerAddress: (address) => `https://xmrchain.net/search?value=${address}`,
  explorerTx: (hash) => `https://xmrchain.net/tx/${hash}`,
};

export const MONERO_NOT_IMPLEMENTED = NOT_IMPLEMENTED;
