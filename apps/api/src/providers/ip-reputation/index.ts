/**
 * C93.5 (Workflow 7A, decision 8): the `ipReputation` provider, read by both the API (session
 * evaluation, C93.2) and the worker (the `ip-address` report, C106.1).
 *
 * - `mmdb-file`: an operator-licensed MMDB with anonymous-IP fields, read from
 *   `OPENVERIFY_IP_REPUTATION_MMDB_PATH` (mounted read-only by compose). Its licence is the
 *   operator's; nothing is downloaded, and a lookup sends nothing anywhere.
 * - `sandbox` (sandbox environments only, ADR 0002 §3d): the magic addresses of C93.6 (`192.0.2.40`
 *   is a proxy).
 *
 * Both adapters answer `true` for a flagged address, `false` only where the file positively
 * records a negative (`anonymousIpAnswer` of `@openverify/signals/network`: commercial anonymous-IP
 * files flag addresses rather than clear them), and `null` otherwise (`not_in_provider_data`). The
 * file is opened at the first lookup and kept; a file that cannot be opened fails each lookup
 * (`IpReputationUnavailableError`), which the evaluation reads as no adapter
 * (`provider_not_configured`), never as "not in the data". Nothing is logged here, and no error
 * names the path or an address. Owner: `api-network` (Workflow 7A Stage 3).
 */
import { readFileSync } from 'node:fs';
import {
  MmdbSnapshot,
  anonymousIpAnswer,
  lookupAnonymousIp,
  parseAddress,
} from '@openverify/signals/network';
import type { IpReputationProvider } from '../../ports.js';

/** The names the `ipReputation` kind takes (C93.5). */
export const IP_REPUTATION_PROVIDER_NAMES = ['mmdb-file', 'sandbox'] as const;
export type IpReputationProviderName = (typeof IP_REPUTATION_PROVIDER_NAMES)[number];

/** What the factory reads: the MMDB path for `mmdb-file` (`null` for the sandbox). */
export interface IpReputationProviderOptions {
  mmdbPath: string | null;
}

/** A lookup of the stub provider, before `api-network` built the adapters (none is left). */
export class IpReputationNotBuiltError extends Error {
  override name = 'IpReputationNotBuiltError';

  constructor(provider: IpReputationProviderName) {
    super(`the ${provider} ipReputation provider is not built yet (api-network, Workflow 7A)`);
  }
}

/** The operator's file could not be opened or is not an anonymous-IP MMDB. */
export class IpReputationUnavailableError extends Error {
  override name = 'IpReputationUnavailableError';

  constructor() {
    super('the ipReputation file cannot be read as an anonymous-IP MMDB');
  }
}

/** C93.6: the sandbox's flagged addresses and their kind (`SANDBOX_NETWORK.proxy`). */
const SANDBOX_PROXIES: ReadonlyMap<string, string> = new Map([['192.0.2.40', 'public_proxy']]);

const NOT_IN_DATA = Object.freeze({ value: null, proxyType: null, connectionType: null });

/**
 * The `ipReputation` provider bound to `name`.
 * @throws {Error} when `mmdb-file` has no path (the configuration refuses that first).
 */
export function createIpReputationProvider(
  name: IpReputationProviderName,
  options: IpReputationProviderOptions,
): IpReputationProvider {
  if (name === 'sandbox') {
    return {
      id: 'sandbox',
      sandbox: true,
      lookup(address) {
        const parsed = parseAddress(address);
        const proxyType = parsed === null ? undefined : SANDBOX_PROXIES.get(parsed.text);
        return proxyType === undefined
          ? { ...NOT_IN_DATA }
          : { value: true, proxyType, connectionType: null };
      },
    };
  }
  const path = options.mmdbPath;
  if (path === null) {
    throw new Error('mmdb-file needs its file (OPENVERIFY_IP_REPUTATION_MMDB_PATH)');
  }
  let file: MmdbSnapshot | null = null;
  const opened = (): MmdbSnapshot => {
    if (file === null) {
      try {
        file = MmdbSnapshot.open(readFileSync(path), 'anonymous-ip');
      } catch {
        throw new IpReputationUnavailableError();
      }
    }
    return file;
  };
  return {
    id: 'mmdb-file',
    sandbox: false,
    lookup(address) {
      const snapshot = opened();
      const parsed = parseAddress(address);
      if (parsed === null) {
        return { ...NOT_IN_DATA };
      }
      return { ...anonymousIpAnswer(lookupAnonymousIp(snapshot, parsed)), connectionType: null };
    },
  };
}
