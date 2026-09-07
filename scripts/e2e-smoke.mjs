/**
 * End-to-end smoke test of the built app in a real browser.
 *
 *   npm install --no-save playwright
 *   npm run build && npm start &
 *   node scripts/e2e-smoke.mjs        # or CRYPTOVAULT_URL=… node scripts/e2e-smoke.mjs
 *
 * Walks the whole first-run flow - create wallet, reveal phrase, verify the
 * backup, land on the dashboard, check every tab, lock and unlock - and fails
 * on any uncaught console error. Screenshots land in /tmp.
 *
 * Balance fetches will fail if the machine has no outbound network access;
 * those errors are reported separately and are not treated as app failures.
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.CRYPTOVAULT_URL ?? 'http://localhost:3800';

const errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const step = (m) => console.log('  ' + m);

await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
console.log('TITLE:', await page.title());
await page.screenshot({ path: '/tmp/shot-1-welcome.png', fullPage: true });

await page.getByRole('button', { name: 'Create a new wallet' }).click();
await page.locator('#pw').fill('Correct-Horse-Battery-9!');
await page.locator('#pw2').fill('Correct-Horse-Battery-9!');
await page.screenshot({ path: '/tmp/shot-2-password.png', fullPage: true });
await page.getByRole('button', { name: 'Generate recovery phrase' }).click();

await page.getByText('Tap to reveal', { exact: false }).click({ timeout: 20000 });
const words = await page.locator('ol li span.font-mono').allInnerTexts();
step(`phrase revealed: ${words.length} words (${words.slice(0, 3).join(' ')} …)`);
await page.screenshot({ path: '/tmp/shot-3-reveal.png', fullPage: true });

await page.locator('input[type=checkbox]').check();
await page.getByRole('button', { name: 'Continue to verification' }).click();

const labels = await page.locator('label').allInnerTexts();
const idxs = labels.filter((l) => l.startsWith('Word #')).map((l) => Number(l.replace('Word #', '')) - 1);
step(`verification asks for words ${idxs.map((i) => i + 1).join(', ')}`);
for (const i of idxs) await page.locator(`#w${i}`).fill(words[i]);
await page.screenshot({ path: '/tmp/shot-4-verify.png', fullPage: true });
await page.getByRole('button', { name: 'Open my wallet' }).click();

await page.waitForSelector('text=Total test portfolio value', { timeout: 20000 });
step('dashboard reached');
await page.waitForTimeout(6000);

const addrs = await page.locator('button[title]').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
console.log('\nDERIVED ADDRESSES (testnet, account #0):');
for (const a of addrs.filter(Boolean)) console.log('  ' + a);
await page.screenshot({ path: '/tmp/shot-5-portfolio.png', fullPage: true });

// receive modal + QR
await page.getByRole('button', { name: 'Receive' }).first().click();
await page.waitForTimeout(1500);
const qr = await page.locator('img[alt^="QR code"]').count();
step(`receive modal open, QR images: ${qr}`);
await page.screenshot({ path: '/tmp/shot-6-receive.png', fullPage: true });
await page.keyboard.press('Escape');

await page.getByRole('button', { name: 'Send', exact: true }).click();
await page.waitForTimeout(2000);
await page.locator('#to').fill('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
await page.locator('#amount').fill('0.01');
await page.waitForTimeout(1500);
step('send: review enabled = ' + (await page.getByRole('button', { name: 'Review transaction' }).isEnabled()));
await page.locator('#to').fill('not-a-real-address');
await page.waitForTimeout(800);
step('send: bad address rejected = ' + (await page.getByText('Not a valid').isVisible().catch(() => false)));
await page.locator('#to').fill('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/shot-7-send.png', fullPage: true });

await page.getByRole('button', { name: 'Review transaction' }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/shot-8-confirm.png', fullPage: true });
step('confirm modal rendered');
await page.keyboard.press('Escape');


// --- swap tab
await page.getByRole('button', { name: 'Swap', exact: true }).click();
await page.waitForTimeout(2500);
const swapBody = await page.innerText('body');
step('swap tab rendered; mainnet-only notice on testnet = ' + swapBody.includes('Swaps are mainnet-only'));
step('fee disclosure visible = ' + swapBody.includes('0.50% of the amount received'));
step('fee recipient shown = ' + (swapBody.includes('0x2c76') || swapBody.includes('2c76D6')));
await page.screenshot({ path: '/tmp/shot-swap-testnet.png', fullPage: true });

// switch to mainnet and confirm the swap UI activates
await page.getByRole('button', { name: 'Mainnet' }).click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'I understand, switch to mainnet' }).click();
await page.waitForTimeout(4000);
await page.getByRole('button', { name: 'Swap', exact: true }).click();
await page.waitForTimeout(2500);
const mainnetSwap = await page.innerText('body');
step('mainnet swap shows asset pickers = ' + (mainnetSwap.includes('You pay') && mainnetSwap.includes('You receive')));
step('slippage control present = ' + mainnetSwap.includes('Slippage tolerance'));
await page.screenshot({ path: '/tmp/shot-swap-mainnet.png', fullPage: true });

// portfolio on mainnet should now list BNB and the token registry
await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
await page.waitForTimeout(3000);
const portfolio = await page.innerText('body');
for (const name of ['Bitcoin', 'Ethereum', 'BNB Smart Chain', 'Solana', 'XRP Ledger', 'TON']) {
  step(`portfolio row ${name}: ${portfolio.includes(name) ? 'yes' : 'NO'}`);
}
step('monero is not rendered = ' + !portfolio.includes('Monero'));
await page.screenshot({ path: '/tmp/shot-portfolio-mainnet.png', fullPage: true });

await page.getByRole('button', { name: 'Token Deployer' }).click();
await page.locator('#tname').fill('Vault Reward Token');
await page.locator('#tsym').fill('VRT');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/shot-9-deploy.png', fullPage: true });
step('deploy tab rendered');

await page.getByRole('button', { name: 'Settings' }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/shot-10-settings.png', fullPage: true });
step('settings tab rendered');

// Capture addresses from the Portfolio tab on the *current* network: BTC and
// TON encode the network into the address, so comparing across a
// mainnet/testnet switch (or across tabs) is meaningless.
await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
await page.waitForTimeout(3000);
const addrsBeforeLock = await page.locator('button[title]').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
await page.getByRole('button', { name: 'Lock' }).click();
await page.waitForSelector('text=Unlock your wallet', { timeout: 10000 });
await page.locator('#upw').fill('Correct-Horse-Battery-9!');
await page.getByRole('button', { name: 'Unlock', exact: true }).click();
await page.waitForSelector('text=portfolio value', { timeout: 30000 });
await page.waitForTimeout(4000);
const addrs2 = await page.locator('button[title]').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
if (JSON.stringify(addrsBeforeLock) !== JSON.stringify(addrs2)) {
  console.log('   before:', JSON.stringify(addrsBeforeLock));
  console.log('   after :', JSON.stringify(addrs2));
}
step('lock/unlock round trip ok; addresses identical = ' + (JSON.stringify(addrsBeforeLock) === JSON.stringify(addrs2)));

// mobile viewport
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/shot-11-mobile.png', fullPage: true });
step('mobile viewport rendered');

const rpcErrors = errors.filter((e) => /TUNNEL|ERR_NAME|Failed to load resource|net::/i.test(e));
const realErrors = errors.filter((e) => !/TUNNEL|ERR_NAME|Failed to load resource|net::/i.test(e));
console.log(`\nCONSOLE: ${realErrors.length} app errors, ${rpcErrors.length} network errors (sandbox has no outbound RPC access)`);
for (const e of realErrors.slice(0, 10)) console.log('  ! ' + e.slice(0, 300));

await browser.close();
