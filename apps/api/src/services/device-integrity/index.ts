/**
 * C211.4 (Workflow 10B): the `deviceIntegrity` providers, built by `api-integrity`; the factory's
 * name and its binding (`providers/index.ts`, kind `deviceIntegrity`, names `play-integrity` and
 * `sandbox`) were placed by `foundation-10b` (Stage 1b (I)).
 *
 * - `play-integrity` (`play-integrity.ts`): decodes a token through Google's
 *   `decodeIntegrityToken` with the operator's service account (an RS256 JWT signed with
 *   `node:crypto` for the OAuth token, no Google library), through the outbound client (15 s, no
 *   redirects), in the `integrity-decode` job only, with the settings `OPENVERIFY_PLAY_INTEGRITY_*`
 *   (`config.ts`), never logged. Without them its decode refuses (`not_configured`).
 * - `sandbox` (`sandbox.ts`): answers deterministically from the magic tokens
 *   (`SANDBOX_INTEGRITY_TOKENS`); never bound to production (`providers/index.ts` refuses it).
 *
 * Either answers C211.4's projection only (`projection.ts`), never another member of a verdict.
 */
import type { OutboundHttp } from '../../http/index.js';
import type { Clock, DeviceIntegrityProvider } from '../../ports.js';
import { DeviceIntegrityDecodeError } from './errors.js';
import { createPlayIntegrityDecoder, type PlayIntegritySettings } from './play-integrity.js';
import { sandboxVerdict } from './sandbox.js';

export { DeviceIntegrityDecodeError } from './errors.js';
export { sandboxVerdict } from './sandbox.js';
export type { PlayIntegritySettings } from './play-integrity.js';

export type DeviceIntegrityProviderName = DeviceIntegrityProvider['name'];

/** What the providers need. */
export interface DeviceIntegrityProviderOptions {
  outboundHttp?: OutboundHttp | undefined;
  clock?: Clock | undefined;
  /** C211.4: `play-integrity`'s settings (`OPENVERIFY_PLAY_INTEGRITY_*`); the sandbox needs none. */
  playIntegrity?: PlayIntegritySettings | null | undefined;
}

const systemClock: Clock = { now: () => new Date() };

/** The `deviceIntegrity` provider named `name`. */
export function createDeviceIntegrityProvider(
  name: DeviceIntegrityProviderName,
  options: DeviceIntegrityProviderOptions = {},
): DeviceIntegrityProvider {
  const clock = options.clock ?? systemClock;
  if (name === 'sandbox') {
    return {
      id: name,
      name,
      sandbox: true,
      decode: ({ token }) => {
        try {
          return Promise.resolve({ ...sandboxVerdict(token, clock.now()) });
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    };
  }
  const { playIntegrity, outboundHttp } = options;
  const decode =
    playIntegrity == null || outboundHttp === undefined
      ? null
      : createPlayIntegrityDecoder(playIntegrity, outboundHttp, clock);
  return {
    id: name,
    name,
    sandbox: false,
    decode: async (request) => {
      if (decode === null) {
        throw new DeviceIntegrityDecodeError('not_configured', false);
      }
      return { ...(await decode(request)) };
    },
  };
}
