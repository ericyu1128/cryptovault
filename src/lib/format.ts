/** Formatting helpers shared by every chain. All amounts are bigint + decimals. */

export function formatUnits(raw: bigint, decimals: number, maxFractionDigits = 8): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;

  let fracStr = frac.toString().padStart(decimals, '0').slice(0, maxFractionDigits);
  fracStr = fracStr.replace(/0+$/, '');

  const wholeStr = whole.toLocaleString('en-US');
  return `${negative ? '-' : ''}${wholeStr}${fracStr ? `.${fracStr}` : ''}`;
}

export function parseUnits(amount: string, decimals: number): bigint {
  const clean = amount.trim().replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(clean) || clean === '' || clean === '.') {
    throw new Error(`"${amount}" is not a valid amount`);
  }
  const [whole = '0', frac = ''] = clean.split('.');
  if (frac.length > decimals) {
    throw new Error(`Too many decimal places - this chain supports ${decimals}`);
  }
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

export function toNumber(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 3) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '$0.00';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  });
}

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
