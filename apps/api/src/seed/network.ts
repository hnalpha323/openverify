/**
 * C92.1, C93.6 (Workflow 7A; owner `api-network`): the synthetic sandbox network data `seed:dev`
 * imports, so a fresh stack's sandbox sessions and `ip-address` reports answer without a download.
 * It reconciles the network source rows first, then imports `openverify-sandbox-network` (the
 * documentation ranges and fictional ASNs of C93.6, built by `@openverify/signals/testing`) as an
 * `import` sync, and warns, naming `python3 scripts/fetch_data.py`, when the pinned ASN seeds are
 * missing (C92.6). No publisher is called.
 *
 * Without object storage nothing can be imported (the snapshot is an object, C92.3), and the seed
 * says so; `scripts/seed-dev.ts` passes none today, which `integration-7a` gives it from `S3_*`.
 * The signature is frozen by `foundation-7a` (Stage 1b (N)); `asnData` is for tests.
 */
import type { Db } from '@openverify/db';
import { sandboxNetworkBundle } from '@openverify/signals/testing';
import type { NetworkSettings } from '../config.js';
import { loadAsnData, type AsnData } from '../network/asn-data.js';
import { reconcileNetworkSources } from '../network/reconcile.js';
import { syncNetworkSource } from '../network/sync.js';
import { watchlistSessionsOf } from '../watchlists/sync-session.js';
import type { Clock, FileStorage } from '../ports.js';

export interface SeedNetworkOptions extends Pick<
  NetworkSettings,
  'sourcesDisabled' | 'sourcesEnabled'
> {
  clock: Clock;
  /** Where an import writes its snapshot (C92.3); without it nothing can be imported. */
  storage?: FileStorage | undefined;
  /** The pinned ASN seeds; `loadAsnData()` by default (tests pass their own). */
  asnData?: (() => AsnData) | undefined;
}

/** What the seed imported, per source, or why it imported nothing. */
export interface SeededNetworkData {
  sources: { sourceId: string; outcome: string; entryCount: number }[];
  /** Why something was left out, such as the ASN seeds missing (C92.6); `null` otherwise. */
  warning: string | null;
}

const SANDBOX_SOURCE = 'openverify-sandbox-network';
const SILENT = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** C92.1, C93.6: imports the sandbox network data; see the file header. */
export async function seedNetworkData(
  db: Db,
  options: SeedNetworkOptions,
): Promise<SeededNetworkData> {
  await reconcileNetworkSources(db, {
    sourcesDisabled: options.sourcesDisabled,
    sourcesEnabled: options.sourcesEnabled,
    clock: options.clock,
  });
  const warnings: string[] = [];
  const sources: SeededNetworkData['sources'] = [];
  if (options.sourcesDisabled.includes(SANDBOX_SOURCE)) {
    warnings.push(
      `${SANDBOX_SOURCE} is turned off by OPENVERIFY_NETWORK_SOURCES_DISABLED: no sandbox network data was imported`,
    );
  } else if (options.storage === undefined) {
    warnings.push(
      'no object storage was given: the sandbox network data was not imported (its snapshot is an object, C92.3)',
    );
  } else {
    const result = await syncNetworkSource(
      {
        db,
        connect: watchlistSessionsOf(db),
        clock: options.clock,
        logger: SILENT,
        storage: options.storage,
      },
      { sourceId: SANDBOX_SOURCE, actor: 'seed', importBytes: sandboxNetworkBundle() },
    );
    sources.push({
      sourceId: result.sourceId,
      outcome: result.outcome,
      entryCount: result.entryCount,
    });
  }
  const asn = (options.asnData ?? (() => loadAsnData()))();
  if (asn.status !== 'loaded') {
    warnings.push(
      'the pinned ASN seeds are not fetched or not as pinned: run python3 scripts/fetch_data.py; until then the VPN and hosting-ASN flags read null (list_unavailable)',
    );
  }
  return { sources, warning: warnings.length === 0 ? null : warnings.join('; ') };
}
