/**
 * C208.1 (decision 69; review F27; Phase 10, Workflow 10C): `trust:sandbox-utopia` installs or
 * refreshes the sandbox-only Utopia anchor through `applyTrustSync` to the `openverify-sandbox`
 * source, in any mode (`seed:dev`, the only other path, refuses production). The anchor is
 * `sandbox_only`, so a production environment's loaders never see it (Phase 5 C62.8). Owned by
 * `api-nfc`; `scripts/trust-sandbox-utopia.ts` is its thin entry.
 *
 * It prints one line: the outcome, the source and the CRL's next update. Run it again before that
 * date: without a current CRL the server's revocation check is undetermined and a chip under the
 * anchor goes to review (C62.3).
 */
import { trustAnchorSourceOf, type Db } from '@openverify/db';
import type { Clock } from '../ports.js';
import { installSandboxTrustAnchor, SANDBOX_TRUST_SOURCE } from '../trust-anchors/sandbox.js';

/** What one run works with (the entry point builds it from the environment). */
export interface TrustSandboxUtopiaRuntime {
  db: Db;
  clock: Clock;
  /** One line per outcome: codes and dates only. */
  out: (line: string) => void;
}

/** What a run did: `installed` where no enabled source listed the anchor before, else `refreshed`. */
export interface TrustSandboxUtopiaOutcome {
  outcome: 'installed' | 'refreshed';
  /** The anchor's id (its certificate's SHA-256). */
  anchorId: string;
  crlNextUpdate: Date;
}

/**
 * Installs or refreshes the sandbox Utopia anchor and its CRL as of the clock, in any mode. The
 * anchor's id is stable within a calendar year (`buildUtopiaCsca`), so a run in the same year
 * finds the anchor it installed and only renews the CRL.
 */
export async function runTrustSandboxUtopia(
  runtime: TrustSandboxUtopiaRuntime,
): Promise<TrustSandboxUtopiaOutcome> {
  const { db, clock, out } = runtime;
  const now = clock.now();
  const { buildUtopiaCsca } = await import('@openverify/emrtd/testing');
  const { createHash } = await import('node:crypto');
  const expected = createHash('sha256').update(buildUtopiaCsca({ now }).der).digest('hex');
  const listedBefore = (await trustAnchorSourceOf(db, expected)) !== null;
  const installed = await installSandboxTrustAnchor(db, { now });
  const outcome = listedBefore ? 'refreshed' : 'installed';
  out(
    `trust:sandbox-utopia ${outcome} source=${SANDBOX_TRUST_SOURCE} crl-next-update=${installed.crlNextUpdate.toISOString()}`,
  );
  return { outcome, anchorId: installed.anchorId, crlNextUpdate: installed.crlNextUpdate };
}
