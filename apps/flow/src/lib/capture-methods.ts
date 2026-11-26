/**
 * C153.2 (Workflow 9A; decision 22): which capture methods a step offers on this device. A step's
 * `captureMethodsByDevice` names methods per device class (`desktop-web`, `mobile-web`, `native`);
 * the web flow applies its own class's entry, else the step's `captureMethods`. Client-reported
 * guidance only: the server cannot prove how a photo was taken.
 */
import type { CaptureMethod } from '../api/flow-api-client';

/** The web flow's device classes (`native` is an SDK's). */
export type WebDeviceKind = 'desktop-web' | 'mobile-web';

/** What the browser says about itself. */
export interface BrowserIdentity {
  readonly userAgent: string;
  readonly userAgentData?: { readonly mobile?: boolean } | undefined;
}

/** A phone or a tablet browser, by its user agent (iPadOS since 13 says Macintosh: `desktop-web`). */
const MOBILE_AGENT = /\b(?:Android|iPhone|iPad|iPod|Mobile|Tablet)\b/u;

/**
 * This browser's class: `mobile-web` for a phone or tablet (the client hint first, then the user
 * agent), else `desktop-web`. Guidance only, as the person's browser can say anything.
 */
export function webDeviceKind(browser: BrowserIdentity): WebDeviceKind {
  if (browser.userAgentData?.mobile === true) {
    return 'mobile-web';
  }
  return MOBILE_AGENT.test(browser.userAgent) ? 'mobile-web' : 'desktop-web';
}

export function captureMethodsFor(
  step: {
    readonly captureMethods: readonly CaptureMethod[];
    readonly captureMethodsByDevice?:
      | {
          readonly 'desktop-web'?: readonly CaptureMethod[] | undefined;
          readonly 'mobile-web'?: readonly CaptureMethod[] | undefined;
          readonly native?: readonly CaptureMethod[] | undefined;
        }
      | undefined;
  },
  kind: WebDeviceKind,
): readonly CaptureMethod[] {
  return step.captureMethodsByDevice?.[kind] ?? step.captureMethods;
}

/** How each captured photo was taken, by the photo itself (C153.2's `capture-method`). */
const SOURCES = new WeakMap<Blob, CaptureMethod>();

/** Remembers that `photo` was taken by `method`. */
export function rememberCaptureMethod(photo: Blob, method: CaptureMethod): void {
  SOURCES.set(photo, method);
}

/** How `photo` was taken, or `undefined` when nothing says. */
export function captureMethodOf(photo: Blob): CaptureMethod | undefined {
  return SOURCES.get(photo);
}
