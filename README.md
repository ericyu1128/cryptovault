# CryptoVault

A self-custodial, **100% client-side** multi-chain wallet and ERC-20 deployment dashboard.
One BIP-39 recovery phrase; five independent key trees; no backend, no accounts, no telemetry.

| Chain | Assets | Addresses | Send | Swap |
|---|---|---|---|---|
| **Bitcoin** | BTC | SegWit (BIP-84) + Taproot (BIP-86) | ✅ UTXO selection, change | — |
| **Ethereum** | ETH, USDC, USDT, any ERC-20 | BIP-44 `0x…` | ✅ native + tokens | ✅ 0x |
| **BNB Smart Chain** | BNB, USDC, USDT | same key as Ethereum | ✅ native + tokens | ✅ 0x |
| **Solana** | SOL, USDC, USDT, any SPL | Ed25519, SLIP-0010 | ✅ native + SPL | ✅ Jupiter |
| **XRP Ledger** | XRP | secp256k1 `r…` | ✅ + destination tag | — |
| **TON** | TON | Wallet V4R2 | ✅ + text comment | — |
| **Monero** | — | *not implemented* | — | — |

Plus a **Token Deployer** (sign and broadcast a real OpenZeppelin ERC-20 from your own key) and a
**Swap** tab that routes token-to-token trades through 0x on EVM and Jupiter on Solana.

---

## ⚠️ Read this first

This is a real wallet that holds real keys.

- **Your recovery phrase is the wallet.** It is encrypted with your password and stored in this
  browser's `localStorage`. There is no server, no account and no reset link. Clear your browser
  data without a written backup and the funds are gone permanently.
- **The app is only as safe as the origin it runs on.** Any script that executes on the same origin
  while the wallet is unlocked can read the decrypted phrase out of memory. Do not add analytics,
  ad tags, or third-party widgets. Do not host it next to untrusted code.
- **It boots on testnets on purpose.** Switching to mainnet is a deliberate, confirmed action.
- **It has not been audited.** The derivation is verified against published test vectors (see
  [Testing](#testing)) and the contract is unmodified OpenZeppelin, but the app as a whole has had
  no third-party security review. Use testnets, then small amounts, then decide.
- For real money, a hardware wallet keeps the key off the machine entirely. This is a browser
  wallet: convenient, and exactly as exposed as the browser it runs in.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

That's it — every endpoint is public and keyless by default. Copy `.env.example` to `.env.local`
only when you outgrow the public rate limits.

```bash
npm run build && npm start   # production build
npm run typecheck            # tsc --noEmit
npm test                     # typecheck + derivation test vectors
```

### Getting test coins

The Portfolio tab links a faucet for each chain while you are on testnet. Order of operations:
fund Sepolia first (you need gas to deploy a token), then whatever else you want to play with.

---

## File structure

```
cryptovault/
├── contracts/
│   └── CryptoVaultToken.sol          Solidity source for the deployer
├── scripts/
│   ├── compile-contract.mjs          solc → src/lib/contracts/erc20.ts
│   ├── ts-loader.mjs                 lets plain `node` run the TS in src/
│   ├── test-derivation.ts            BIP-39/32/84/86 + SLIP-0010 test vectors
│   ├── test-evm-integration.ts       deploy + transfer against a local chain
│   └── e2e-smoke.mjs                 Playwright walk-through of the whole UI
├── src/
│   ├── app/
│   │   ├── layout.tsx                metadata + fonts
│   │   ├── page.tsx                  mounts the client app, nothing else
│   │   ├── icon.svg
│   │   └── globals.css               Tailwind 4 theme tokens
│   ├── components/
│   │   ├── App.tsx                   boot, gate/dashboard switch, auto-lock
│   │   ├── WalletGate.tsx            create / reveal / verify / import / unlock
│   │   ├── Dashboard.tsx             header, network switch, tabs, backup banner
│   │   ├── ReceiveModal.tsx          QR + address, SegWit/Taproot toggle
│   │   ├── TokenList.tsx             tracked ERC-20 balances
│   │   ├── ToastViewport.tsx         transaction status notifications
│   │   ├── tabs/
│   │   │   ├── PortfolioTab.tsx
│   │   │   ├── SendTab.tsx
│   │   │   ├── DeployTab.tsx
│   │   │   └── SettingsTab.tsx
│   │   └── ui/index.tsx              Button, Card, Modal, Alert, Badge, …
│   ├── lib/
│   │   ├── polyfills.ts              Buffer/process shims for the chain SDKs
│   │   ├── format.ts                 bigint ⇄ decimal string, no floats
│   │   ├── prices.ts                 CoinGecko USD marks
│   │   ├── crypto/
│   │   │   ├── mnemonic.ts           BIP-39 generate / validate / seed
│   │   │   ├── slip10.ts             SLIP-0010 ed25519 derivation
│   │   │   └── vault.ts              AES-GCM + PBKDF2 encrypted storage
│   │   ├── chains/
│   │   │   ├── types.ts              the ChainAdapter interface
│   │   │   ├── meta.ts               SDK-free chain metadata
│   │   │   ├── networks.ts           every RPC endpoint and explorer
│   │   │   ├── index.ts              lazy adapter registry
│   │   │   ├── bitcoin.ts   evm.ts   solana.ts   xrp.ts   ton.ts
│   │   └── contracts/
│   │       ├── erc20.ts              GENERATED: ABI + creation bytecode
│   │       └── deploy.ts             quote + deploy through ethers
│   └── state/
│       ├── walletStore.ts            zustand: keys, accounts, balances
│       ├── settings.ts               persisted, non-secret preferences
│       └── toastStore.ts
├── next.config.ts
├── postcss.config.mjs
└── tsconfig.json
```

## Dependencies

**Runtime**

| Package | Why |
|---|---|
| `next` `react` `react-dom` | App Router, all client components |
| `tailwindcss` `@tailwindcss/postcss` | styling (v4, CSS-first config) |
| `zustand` | wallet + toast state |
| `@scure/bip39` `@scure/bip32` `@scure/base` | BIP-39 phrases, BIP-32 HD derivation |
| `@scure/btc-signer` | Bitcoin addresses, PSBT-style signing, broadcast |
| `@noble/hashes` `@noble/curves` | HMAC-SHA512 for SLIP-0010; audited primitives |
| `ethers` | EVM accounts, transactions, contract deployment |
| `@solana/web3.js` `@solana/spl-token` | Solana keypairs, transfers, SPL balances |
| `xrpl` | XRPL `Wallet` — key derivation and transaction signing |
| `@ton/ton` `@ton/core` `@ton/crypto` | TON Wallet V4R2, message building, toncenter client |
| `qrcode` | receive QR codes |
| `buffer` | `Buffer` shim the chain SDKs still expect |

**Dev**

`typescript`, `@types/*`, `solc` (compiles the contract at build time),
`@openzeppelin/contracts` (the contract's imports).

---

## How it works

### Key management

```
password ──PBKDF2-SHA256(600k)──► AES-256-GCM key
                                      │
recovery phrase ──────────────────encrypt──► localStorage   (at rest)
        │
        └── BIP-39 seed (in memory only)
                 ├── m/84'|86'/0'|1'/N'/0/0   → Bitcoin      (@scure/btc-signer)
                 ├── m/44'/60'/N'/0/0         → Ethereum     (ethers)
                 ├── m/44'/501'/N'/0'         → Solana       (SLIP-0010 ed25519)
                 ├── m/44'/144'/N'/0/0        → XRP Ledger   (secp256k1)
                 └── m/44'/607'/N'            → TON          (SLIP-0010 ed25519)
```

The decrypted phrase and seed live in a single zustand store and **never** touch storage, a
network request, or a URL. They are zeroed on lock, on wipe, and by the inactivity auto-lock
(15 minutes by default). Every signing operation re-derives the private key from the seed, uses
it, and drops it — no long-lived key objects.

Bitcoin derives both a SegWit and a Taproot address from the same account so you can receive to
either; the Settings tab picks which one spends.

**Compatibility note on TON:** CryptoVault uses SLIP-0010 at `m/44'/607'/N'` — the Trust Wallet
convention. Tonkeeper derives from TON's own 24-word mnemonic scheme instead, so importing this
phrase there gives a *different* address. The address shown in the app is the correct one for
this wallet.

### Adapter architecture

Every chain implements one interface (`src/lib/chains/types.ts`):

```ts
interface ChainAdapter {
  meta: ChainMeta;
  derive(seed, opts): Promise<DerivedAccount>;
  getBalance(address, mode): Promise<ChainBalance>;
  estimateFee(params): Promise<FeeQuote>;
  send(params): Promise<SendResult>;
  validateAddress(address, mode): boolean;
  explorerAddress(address, mode): string;
  explorerTx(hash, mode): string;
}
```

Adapters are **code-split** and loaded on demand (`getAdapter('solana')`), so opening the wallet
does not download five chain SDKs. Balances are fetched per chain in parallel and failures are
isolated — a dead RPC greys out one row instead of blanking the portfolio.

All amounts are `bigint` in the chain's smallest unit (sats, wei, lamports, drops, nanotons).
No floating point touches a balance anywhere in the codebase.

### Transactions

Nothing is delegated. For each chain the app builds the transaction locally, signs it with a key
derived in memory, and POSTs the signed blob to a public node:

- **Bitcoin** — fetches confirmed UTXOs, selects coins largest-first, sizes the fee from a real
  vbyte estimate at the current `sat/vB`, returns change to your own address (dropping it to the
  miner if it would be dust), signs with `@scure/btc-signer`, broadcasts the raw hex.
- **Ethereum** — `ethers` EIP-1559 transaction, or an ERC-20 `transfer` when an asset is selected.
- **Solana** — `SystemProgram.transfer` (+ SPL Memo), signed and confirmed at `confirmed`.
- **XRP** — `Payment` signed by `xrpl`'s `Wallet`, submitted over HTTP JSON-RPC. Only
  `tesSUCCESS`/`terQUEUED` count as success; anything else surfaces the engine result verbatim.
- **TON** — Wallet V4R2 transfer, non-bounceable, external message built by hand so the app can
  hash it and give you a link the explorer can actually resolve.

### The Token Deployer

`contracts/CryptoVaultToken.sol` is OpenZeppelin `ERC20` + `ERC20Burnable` + `ERC20Permit` +
`Ownable`, with configurable decimals and a one-way `finishMinting()`. There is deliberately no
pause, no blocklist, no transfer tax and no proxy — the features that make a token look like a
honeypot.

It is compiled **at build time** by `scripts/compile-contract.mjs` and the ABI + creation bytecode
are written into `src/lib/contracts/erc20.ts`. That keeps ~10 MB of `solc` WASM out of the browser
bundle and makes the bytecode reproducible: re-run `npm run compile:contract` and diff.

```bash
npm run compile:contract
# compiled CryptoVaultToken with solc 0.8.36 · optimizer 200 runs · evmVersion cancun
```

Deployment does a real `eth_estimateGas` against the encoded constructor first, so bad arguments
fail before you commit, and you see the cost in ETH next to your balance. Deployed tokens are
added to the tracked-token list automatically.

> The contract targets the **Cancun** EVM because OpenZeppelin 5.6 uses `MCOPY`. Mainnet, Sepolia
> and every major L2 are well past Cancun. To target an older chain, pin
> `@openzeppelin/contracts` to `5.1.x` and set `evmVersion: 'shanghai'` in the compile script.

---

---

## Swaps and the developer fee

The Swap tab routes trades through a DEX aggregator: **0x Swap API v2**
(allowance-holder flow) on Ethereum and BNB Smart Chain, **Jupiter** on Solana.
Quotes, approvals and the swap itself are all signed in the browser with a key
derived on the fly; the aggregator only ever sees an address and a signed
transaction.

### The 0.5% fee

Every executed swap carries a **50 bps (0.5%) developer fee**, configured in
`src/lib/swap/fees.ts`:

| Chain | Destination | Collected in |
|---|---|---|
| Ethereum, BSC | `0x2c76D6c28e22f432Cf796a53B49C863d62A488C4` | ETH/WETH when either side of the trade is ETH/WETH, otherwise the bought token |
| Solana | `CryVfG5uS6HmKquiecp9VCvo9zRk9bshFsGEfVcUc2iE` | the bought token |

**The fee is shown to the user** in the quote breakdown, the confirmation dialog
and the result toast. Keep it that way. A wallet that silently skims a
percentage is indistinguishable from malware to the person whose money it is,
and every mainstream aggregator displays the number up front — 0x, Jupiter,
1inch, and Uniswap's own interface all do. Disclosure costs nothing.

### Three things the fee cannot do

These are properties of the chains, not of this implementation:

1. **It cannot always arrive as ETH.** An aggregator collects its fee in one of
   the two tokens being traded — 0x requires `swapFeeToken` to be the buy or
   sell token. A USDC→USDT trade therefore pays in USDC or USDT. This app picks
   ETH or WETH whenever either side of the trade is ETH or WETH, which is as
   close to "always ETH" as one transaction allows. Converting every fee to ETH
   would need a second swap whose gas usually exceeds the fee on trades under a
   few hundred dollars.
2. **Solana fees cannot reach an Ethereum address.** Jupiter pays into an
   associated token account on Solana. There is no on-chain path from a Solana
   swap to an `0x…` address; moving the value requires a bridge, which is a
   manual step you take on your own schedule.
3. **Monero cannot route at all.** XMR has no smart contracts and no shared
   execution environment with EVM or Solana. Any XMR trade is a cross-chain
   atomic swap or a third-party service, not a DEX route.

If the fee cannot be attached to a particular route, the swap still executes at
0% rather than failing. A user's trade is never sacrificed to collect a fee.

### Enabling Solana fees

Jupiter's `feeAccount` must be an **initialized associated token account** for
the mint you are earning in — a bare wallet address is rejected, and a missing
account makes the whole swap fail. CryptoVault checks for the account and drops
the fee when it is absent. Create them once:

```bash
SOLANA_FEE_PAYER=~/.config/solana/id.json npm run setup:solana-fees
# add --dry-run first to see what it would create
```

The payer funds about 0.002 SOL of rent per account and needs no authority over
the fee owner.

### API keys

The Swap tab needs `NEXT_PUBLIC_ZEROX_API_KEY` for EVM routes. Jupiter works
without a key on its rate-limited `lite-api` tier.

Both keys ship inside the client bundle and are publicly readable. That is a
real consideration for key abuse, but it does not weaken custody: your seed
phrase still never leaves the browser. If you want the keys hidden, put a thin
proxy in front of those two APIs — nothing else about the architecture changes.

---

## Stablecoins and new chains

`src/lib/chains/tokens.ts` holds a registry verified against issuer sources, not
a token aggregator: Circle for USDC, Tether for USDT, the PancakeSwap default
list for the Binance-Peg wrappers.

Two traps it encodes deliberately:

- **BSC stablecoins are 18 decimals**, where their Ethereum and Solana
  counterparts are 6. Assuming 6 on BSC misprices a transfer by 10¹².
  Registry decimals are advisory only — every write path calls
  `resolveDecimals()` and reads the real value from chain first, and SPL
  transfers use `transferChecked`, which re-validates decimals on chain.
- **USDT on Ethereum has a non-standard ABI.** Tether's own docs note it "does
  not return a Boolean value in the transfer function", and it reverts when a
  non-zero allowance is changed to another non-zero value. Writes go through an
  ABI declared with no return values, and `ensureAllowance()` resets the
  allowance to zero first for known-quirky tokens — with an automatic
  reset-and-retry for tokens not yet in the registry. This is the single most
  common reason a swap UI works for every token except USDT.

BSC reuses the Ethereum adapter entirely: `createEvmAdapter()` is parameterised
by chain, so both networks share one implementation and one derived address.

### Monero

`src/lib/chains/monero.ts` is a stub that satisfies the `ChainAdapter` contract
and throws. It is deliberately excluded from `CHAIN_ORDER`, so nothing renders
it. XMR shares no cryptography with the other chains — CryptoNote keys rather
than BIP-32, no account balances (a wallet trial-decrypts every block with its
view key), and ring signatures for spending. Receive-only support is
self-contained and verifiable against published test vectors; balances and
sending require either a full local node or handing a third-party server your
private view key, which would break this app's zero-backend property. The file
documents the trade-off at the point where you would implement it.


## Testing

```bash
npm test               # typecheck + derivation + swap/registry  (171 assertions)
npm run test:derivation  # BIP-39/32/84/86 + SLIP-0010 vectors    (59)
npm run test:swap        # fee math, token registry, BSC, routing (112)
npm run test:evm         # deploy + transfers + approvals on a local chain (37)
npm run test:e2e         # full browser walk-through
```

**`test:derivation`** checks the code against *published* vectors, not against itself:

- SLIP-0010 ed25519 official test vector 1, all six paths
- BIP-39 seed for the canonical `abandon … about` phrase, plus checksum rejection
- BIP-84 → `bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu`
- BIP-86 → `bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr`
- BIP-44 ETH → `0x9858EfFD232B4033E47d90003D41EC34EcaEda94`
- XRP: our seed-based derivation vs. `xrpl.js`'s own `Wallet.fromMnemonic`, byte for byte
- Solana/TON: address vs. an independent re-derivation through the SLIP-0010 node
- amount parsing/formatting, including rejection of over-precise input

**`test:evm`** needs a Cancun-capable local node on `:8545` seeded with the canonical mnemonic:

```bash
npx hardhat node --port 8545     # or: anvil --chain-id 11155111
NEXT_PUBLIC_RPC_SEPOLIA=http://127.0.0.1:8545 npm run test:evm
```

It deploys the real contract, checks name/symbol/decimals/supply/owner/permit, sends native ETH
and ERC-20 transfers through the adapter, walks the mint → `finishMinting` → revert → burn
lifecycle, and deploys a deliberately non-standard USDT-clone
(`contracts/mocks/MockNonStandardToken.sol`) to prove that a naive re-approve reverts on it while
`ensureAllowance()` recovers.

**`test:swap`** covers the money-losing edge cases: basis-point arithmetic on bigints (including
rounding direction and a 10M-token trade), the fee destination addresses, fee-token preference for
every ETH/WETH combination, every registry address and its decimals, the USDT quirk flags, BSC
address derivation, and provider routing.

**`test:e2e`** requires `npm install --no-save playwright` and a running production build:

```bash
npm run build && npm start &
npx playwright install chromium
npm run test:e2e                  # CRYPTOVAULT_URL=… to point at another host
```

It creates a wallet, reveals and verifies the phrase, walks every tab, sends the review flow
through validation, locks and unlocks, checks a mobile viewport, and fails on any uncaught console
error. Screenshots are written to `/tmp`.

---

## Configuration

Every endpoint has a keyless public default. Override in `.env.local`:

```bash
NEXT_PUBLIC_RPC_ETHEREUM=          # Alchemy / Infura / your node
NEXT_PUBLIC_RPC_SEPOLIA=
NEXT_PUBLIC_RPC_SOLANA=
NEXT_PUBLIC_RPC_SOLANA_DEVNET=
NEXT_PUBLIC_TONCENTER_KEY=         # free key from @tonapibot on Telegram
NEXT_PUBLIC_TONCENTER_TESTNET_KEY=
NEXT_PUBLIC_RPC_XRPL=
NEXT_PUBLIC_RPC_XRPL_TESTNET=
NEXT_PUBLIC_ESPLORA_MAINNET=       # any mempool.space/esplora instance
NEXT_PUBLIC_ESPLORA_TESTNET=
```

Everything is `NEXT_PUBLIC_` because the app is client-side. Never put a secret that matters here.

**Privacy:** requests go straight from your browser to these nodes, so they see your IP alongside
the addresses you query. Run your own node, or proxy, if that matters to you.

---

## Known limitations

- **No transaction history.** Balances only. Every row links to a block explorer for history.
- **Swaps are mainnet-only.** Aggregators route real liquidity, and there is none on a testnet.
- **Monero is not implemented** — see above.
- **No cross-chain swaps.** Each trade stays on one chain.
- **Bitcoin spends confirmed UTXOs only.** Unconfirmed change is ignored, so a second send may
  have to wait for a block.
- **One address per chain per account.** No gap-limit scanning; a phrase imported from a wallet
  that used deeper address indices will show a zero balance here even though the funds exist.
  Change the account index in the header to walk `m/…/N'/…`.
- **Prices are cosmetic** and come from CoinGecko's free tier. Testnet coins are priced at
  mainnet rates, clearly labelled, and are worth nothing.
- **No hardware-wallet support**, no WalletConnect, no dApp browser.

## License

MIT for this application code. `@openzeppelin/contracts` is MIT. The chain SDKs carry their own
licenses (MIT / Apache-2.0).
# cryptovault
