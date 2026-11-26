/**
 * The browser wallets a page can ask to sign (C64.1): EIP-6963 announcements, else an injected
 * `window.ethereum` (EIP-1193). Nothing is loaded and no crypto library runs in the browser: the
 * wallet signs, and the server verifies (C57).
 */
import { useEffect, useState } from 'react';

/** The EIP-1193 surface the flow uses: `request`. */
export interface Eip1193Provider {
  request(args: {
    readonly method: string;
    readonly params?: readonly unknown[];
  }): Promise<unknown>;
}

export interface BrowserWallet {
  /** The EIP-6963 `uuid`, or `injected` for `window.ethereum`. */
  readonly id: string;
  /** The wallet's own name, cut to a sensible length; `null` for `window.ethereum`. */
  readonly name: string | null;
  readonly provider: Eip1193Provider;
}

const MAX_NAME_LENGTH = 64;

function isProvider(value: unknown): value is Eip1193Provider {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { request?: unknown }).request === 'function'
  );
}

/** The wallet an `eip6963:announceProvider` event announces, or `null` when it is malformed. */
function announcedWallet(event: Event): BrowserWallet | null {
  const detail: unknown = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'object' || detail === null) {
    return null;
  }
  const { info, provider } = detail as { info?: unknown; provider?: unknown };
  if (!isProvider(provider) || typeof info !== 'object' || info === null) {
    return null;
  }
  const { uuid, name } = info as { uuid?: unknown; name?: unknown };
  if (typeof uuid !== 'string' || uuid === '') {
    return null;
  }
  const label = typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : '';
  return { id: uuid, name: label === '' ? null : label, provider };
}

/**
 * The wallets that announced themselves (EIP-6963: the page asks once, and a wallet loaded later
 * announces itself), each once; with none, an injected `window.ethereum`.
 */
export function useBrowserWallets(): readonly BrowserWallet[] {
  const [announced, setAnnounced] = useState<readonly BrowserWallet[]>([]);

  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const wallet = announcedWallet(event);
      if (wallet !== null) {
        setAnnounced((current) =>
          current.some(({ id }) => id === wallet.id) ? current : [...current, wallet],
        );
      }
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
    };
  }, []);

  if (announced.length > 0) {
    return announced;
  }
  const injected: unknown = (window as { ethereum?: unknown }).ethereum;
  return isProvider(injected) ? [{ id: 'injected', name: null, provider: injected }] : [];
}

/** A wallet request that did not give what the flow asked for. */
export class WalletRequestError extends Error {
  override readonly name = 'WalletRequestError';
  /** EIP-1193 4001: the user declined in the wallet. */
  readonly declined: boolean;

  constructor(declined: boolean, options?: ErrorOptions) {
    super(declined ? 'The user declined the wallet request' : 'The wallet request failed', options);
    this.declined = declined;
  }
}

/** Calls the wallet; any failure becomes a `WalletRequestError`, never a flow API error. */
export async function walletRequest(
  provider: Eip1193Provider,
  args: { readonly method: string; readonly params?: readonly unknown[] },
): Promise<unknown> {
  try {
    return await provider.request(args);
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    throw new WalletRequestError(code === 4001, { cause: error });
  }
}

/** A message as `personal_sign` takes it: its UTF-8 bytes in hexadecimal. */
export function utf8Hex(message: string): string {
  return `0x${Array.from(new TextEncoder().encode(message), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`;
}
