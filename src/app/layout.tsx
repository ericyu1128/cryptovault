import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CryptoVault — Multi-Chain Wallet & Token Deployer',
  description:
    'Self-custodial browser wallet for Bitcoin, Ethereum, Solana, XRP and TON, with a one-click ERC-20 deployer. Keys never leave your device.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#05070c',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
