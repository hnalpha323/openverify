/**
 * C62.7: the trust-store refresh, a repeatable job of the worker that runs only with
 * `OPENVERIFY_TRUST_ANCHOR_REFRESH=true`. It runs the same sync as `trust-anchors:sync` (its
 * `selfTest()` first) for every enabled source of `trust-anchors/manifest.json`, with ICAO PKD
 * CRLs only under `OPENVERIFY_NFC_ALLOW_ICAO_CRLS=true`, and logs each source's outcome by code
 * and count. It never runs in CI.
 */
import { loadTrustAnchorManifest } from '../../trust-anchors/load.js';
import type { TrustAnchorManifest } from '../../trust-anchors/manifest.js';
import { syncTrustAnchors } from '../../trust-anchors/sync.js';
import type { RepeatableJob } from '../../worker.js';
import { PermanentJobError } from '../errors.js';
import type { RepeatableJobDeps } from './index.js';

/** The job's name, which is also its queue's and its scheduler's. */
export const TRUST_ANCHOR_REFRESH_QUEUE = 'trust-anchor-refresh';

/** How often the trust store is refreshed: every six hours (lists change about monthly). */
export const TRUST_ANCHOR_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface TrustAnchorRefreshOptions {
  /** Reads `trust-anchors/manifest.json` by default. */
  loadManifest?: (() => Promise<TrustAnchorManifest>) | undefined;
}

/** The refresh of the trust store (`deps.nfc`). */
export function trustAnchorRefreshJob(
  deps: RepeatableJobDeps,
  options: TrustAnchorRefreshOptions = {},
): RepeatableJob {
  return {
    name: TRUST_ANCHOR_REFRESH_QUEUE,
    repeat: { every: TRUST_ANCHOR_REFRESH_INTERVAL_MS },
    run: async () => {
      const { outboundHttp } = deps;
      if (outboundHttp === undefined) {
        throw new PermanentJobError('outbound_http_unavailable');
      }
      const manifest = await (options.loadManifest ?? (() => loadTrustAnchorManifest()))();
      const outcomes = await syncTrustAnchors(
        {
          db: deps.db,
          outboundHttp,
          clock: deps.clock,
          allowIcaoCrls: deps.nfc?.allowIcaoCrls ?? false,
        },
        manifest,
      );
      for (const outcome of outcomes) {
        deps.logger.info(
          {
            queue: TRUST_ANCHOR_REFRESH_QUEUE,
            source: outcome.sourceId,
            outcome: outcome.outcome,
            reason: outcome.reason,
            anchorsSeen: outcome.anchorsSeen,
            anchorsWithdrawn: outcome.anchorsWithdrawn,
            crlsUpdated: outcome.crlsUpdated,
            crlsRefused: outcome.crlsRefused,
          },
          'trust store refreshed',
        );
      }
      return outcomes;
    },
  };
}
