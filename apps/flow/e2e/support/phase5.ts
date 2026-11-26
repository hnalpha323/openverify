/**
 * What the Phase 5 mocked specs share (C64.1): the frozen wall clock the page and the mock read
 * together, the checks of what assistive technology hears (live regions, target sizes), the
 * console's unexpected errors, and a fake EIP-1193 wallet. Every value is synthetic.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { MockFlowApi } from './mock-flow-api';

/** The wall clock the Phase 5 specs start at: the mock API's own timestamps. */
export const AT_MS = Date.parse('2026-10-20T12:00:00.000Z');

/**
 * Freezes the page's wall clock (`Date.now`) at `at`, timers still running, and sets the mock's
 * clock to the same time: a code's expiry and the next resend (C55) are read against it, so a
 * countdown moves only when the spec moves the clock.
 */
export async function freezeClock(page: Page, api: MockFlowApi, at = AT_MS): Promise<void> {
  await page.clock.setFixedTime(at);
  api.clockMs = at;
}

/** Moves the frozen clock of the page and of the mock forward by `ms`. */
export async function advanceClock(page: Page, api: MockFlowApi, ms: number): Promise<void> {
  const next = (api.clockMs ?? AT_MS) + ms;
  await page.clock.setFixedTime(next);
  api.clockMs = next;
}

/**
 * A refused request, as Chromium logs it. The mock answers an error status only when the spec
 * asked for it (a golden problem such as the 502 `otp_delivery_failed`), so these are expected.
 */
const REFUSED_REQUEST =
  /^Failed to load resource: the server responded with a status of [45]\d\d\b/u;

/**
 * Console errors and page errors, including Content-Security-Policy violations, except the error
 * answers the spec asked the mock for, which Chromium logs as failed loads.
 */
export function collectUnexpectedErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !REFUSED_REQUEST.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

export function heading(page: Page, name: string): Locator {
  return page.getByRole('heading', { level: 1, name });
}

/**
 * Whether `locator` sits in a live region, so that each change of its text is announced: an
 * element (or an ancestor) with `aria-live` other than `off`, or a role that implies one.
 */
export function inLiveRegion(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const live = new Set(['alert', 'status', 'log', 'timer', 'marquee']);
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      const ariaLive = node.getAttribute('aria-live');
      if ((ariaLive !== null && ariaLive !== 'off') || live.has(node.getAttribute('role') ?? '')) {
        return true;
      }
    }
    return false;
  });
}

/** WCAG 2.2 2.5.8 (AA): a pointer target of at least 24 by 24 CSS pixels. */
export async function expectTargetSize(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, 'the target is laid out').not.toBeNull();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
}

/** A required field's mark: beside its label, hidden from assistive technology (C64.1 forms). */
export async function expectRequiredMark(field: Locator): Promise<void> {
  await expect(field).toHaveAttribute('required', '');
  const mark = await field.evaluate((element) => {
    const label = element.ownerDocument.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    const sibling = label?.nextElementSibling ?? null;
    return {
      inLabel: label?.textContent.includes('*') ?? false,
      text: sibling?.textContent ?? null,
      hidden: sibling?.getAttribute('aria-hidden') ?? null,
    };
  });
  expect(mark).toEqual({ inLabel: false, text: '*', hidden: 'true' });
}

/** What the fake wallet does (C64.1): no key, no cryptography, a fixed synthetic signature. */
export interface FakeWallet {
  /** An EIP-6963 announcement, or an injected `window.ethereum` (EIP-1193). */
  readonly via: 'eip6963' | 'injected';
  /** The account `eth_requestAccounts` answers. */
  readonly account: string;
  /** What `personal_sign` answers: 65 synthetic bytes, never a real signature. */
  readonly signature: string;
  /** The announced name (EIP-6963). */
  readonly name?: string;
  /** `personal_sign` requests the user declines first (EIP-1193 error 4001). */
  readonly declines?: number;
}

/** One request the page made of the fake wallet. */
export interface WalletCall {
  readonly method: string;
  readonly params?: readonly unknown[];
}

/**
 * Installs a fake EIP-1193 provider before the flow loads, announced through EIP-6963 (answering
 * `eip6963:requestProvider`, as wallet extensions do) or injected as `window.ethereum`. It keeps
 * the requests it received in `window.__fakeWalletCalls`.
 */
export async function installFakeWallet(page: Page, wallet: FakeWallet): Promise<void> {
  await page.addInitScript((options: FakeWallet) => {
    const calls: { method: string; params?: unknown[] }[] = [];
    let declines = options.declines ?? 0;
    const provider = {
      request: ({ method, params }: { method: string; params?: unknown[] }) => {
        calls.push(params === undefined ? { method } : { method, params });
        if (method === 'eth_requestAccounts') {
          return Promise.resolve([options.account]);
        }
        if (method === 'personal_sign') {
          if (declines > 0) {
            declines -= 1;
            return Promise.reject(
              Object.assign(new Error('User rejected the request.'), { code: 4001 }),
            );
          }
          return Promise.resolve(options.signature);
        }
        return Promise.reject(Object.assign(new Error('Unsupported method'), { code: 4200 }));
      },
    };
    Object.defineProperty(window, '__fakeWalletCalls', { value: calls });
    if (options.via === 'injected') {
      Object.defineProperty(window, 'ethereum', { value: provider });
      return;
    }
    const announce = () => {
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: Object.freeze({
            info: {
              uuid: '6a0c3f6e-0000-4000-8000-00000000e2e1',
              name: options.name ?? 'Test Wallet',
              icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',
              rdns: 'test.openverify.wallet',
            },
            provider,
          }),
        }),
      );
    };
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
  }, wallet);
}

/** The requests the page made of the fake wallet, in order. */
export function walletCalls(page: Page): Promise<WalletCall[]> {
  return page.evaluate(
    () => (window as unknown as { __fakeWalletCalls: WalletCall[] }).__fakeWalletCalls,
  );
}

/** A message as `personal_sign` takes it: its UTF-8 bytes in hexadecimal. */
export function utf8Hex(message: string): string {
  return `0x${Buffer.from(message, 'utf8').toString('hex')}`;
}
