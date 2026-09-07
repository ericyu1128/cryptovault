import App from '@/components/App';

/**
 * The whole wallet is a client application. Nothing about a key, a phrase or a
 * balance is ever computed on a server - this page exists only to mount it.
 */
export default function Page() {
  return <App />;
}
