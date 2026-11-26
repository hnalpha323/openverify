/**
 * C61.5, C61.6: the sandbox backlink provider (sandbox environments only; no real backlink source
 * ships). It calls nothing: `backlinks.example` (and `www.backlinks.example`) has 250 backlinks,
 * any other host none, so the check fails `backlinks_below_threshold` under the default 10.
 */
import type { BacklinkProvider } from '../../ports.js';

/** The sandbox's host with backlinks, and how many. */
export const SANDBOX_BACKLINK_HOST = 'backlinks.example';
export const SANDBOX_BACKLINK_COUNT = 250;

/** The sandbox backlink provider (C61.6): it calls nothing. */
export function createSandboxBacklinkProvider(): BacklinkProvider {
  return {
    id: 'sandbox',
    sandbox: true,
    count: ({ host }) =>
      Promise.resolve({
        count:
          host === SANDBOX_BACKLINK_HOST || host === `www.${SANDBOX_BACKLINK_HOST}`
            ? SANDBOX_BACKLINK_COUNT
            : 0,
      }),
  };
}
