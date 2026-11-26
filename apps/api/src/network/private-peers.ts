/**
 * C93.1 (P05, Workflow 7A): the trust-mode warnings of the API process.
 *
 * - At startup, a hop count (`OPENVERIFY_TRUST_PROXY=<n>`) logs a warning that names the risk, and
 *   `trust-all` one that says production network facts are `null` with `client_address_untrusted`.
 * - At run time, production sessions that keep arriving from private peers mean a proxy whose
 *   address is not trusted, so every fact describes the proxy: the watch logs that once.
 *
 * Owner: `api-network` (Stage 3), with its test. Logs carry counts and the trust mode only, never an
 * address (C93.7).
 */
import type { TrustProxySetting } from '../operator-auth/settings.js';
import type { EnvironmentKind } from '../ports.js';
import type { WorkerLogger } from '../jobs/logger.js';

/**
 * C93.1: production sessions in a row from private peers before the watch warns. Provisional
 * (basis: a small multiple of what one person's retries make; unmeasured).
 */
export const PRIVATE_PEER_WARN_AFTER = 20;

/** One evaluated session, as the watch sees it: no address. */
export interface PrivatePeerSample {
  environmentKind: EnvironmentKind;
  /** The resolved address is private, loopback, link-local or carrier-grade NAT (C93.1). */
  addressIsPrivate: boolean;
}

/** What `evaluateSessionNetworkInTx` tells the watch about each session it evaluates. */
export interface PrivatePeerWatch {
  observe(sample: PrivatePeerSample): void;
}

/** The trust mode a log names (`client-address-source`'s words). */
function trustModeOf(trustProxy: TrustProxySetting): string {
  if (trustProxy === true) {
    return 'trust-all';
  }
  if (typeof trustProxy === 'number') {
    return 'hop-count';
  }
  return Array.isArray(trustProxy) ? 'trusted-list' : 'socket';
}

/** C93.1: logs the trust-mode warnings at startup and returns the run-time watch. */
export function warnOnPrivatePeers(
  logger: WorkerLogger,
  trustProxy: TrustProxySetting,
): PrivatePeerWatch {
  const trustMode = trustModeOf(trustProxy);
  if (trustMode === 'trust-all') {
    logger.warn(
      { trustMode },
      'OPENVERIFY_TRUST_PROXY=true lets the client choose its address with X-Forwarded-For: production network facts are null with client_address_untrusted; name the proxy addresses instead',
    );
  } else if (trustMode === 'hop-count') {
    logger.warn(
      { trustMode },
      'OPENVERIFY_TRUST_PROXY is a hop count: if a client can reach the API without the proxies, it chooses its own address; prefer the proxies’ addresses or ranges',
    );
  }
  let privateInRow = 0;
  let warned = false;
  return {
    observe(sample) {
      if (sample.environmentKind !== 'production' || warned) {
        return;
      }
      privateInRow = sample.addressIsPrivate ? privateInRow + 1 : 0;
      if (privateInRow >= PRIVATE_PEER_WARN_AFTER) {
        warned = true;
        logger.warn(
          { trustMode, privateSessions: privateInRow },
          'production sessions keep arriving from private addresses: a proxy in front of the API is probably not trusted (OPENVERIFY_TRUST_PROXY), so every network fact describes the proxy',
        );
      }
    },
  };
}
