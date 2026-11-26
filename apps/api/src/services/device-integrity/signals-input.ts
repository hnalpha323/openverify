/**
 * C211.5 (Workflow 10B, `api-integrity`): the inquiry's Play Integrity facts for the signal
 * computation (`computeInquirySignals`' `deviceIntegrity`): the environment kind's bound provider
 * (`null` when none is bound), whether a token was taken and still waits for its decode, and the
 * stored verdict, parsed against C211.4's projection. A stored value outside the projection reads as
 * a failed decode, never as a value, and nothing outside the projection reaches the computation.
 *
 * The `inquiry-signals` job and the flow's provisional snapshots call it beside
 * `inquirySignalsInputInTx` (`jobs/signals/input.ts`), with the worker's bound provider: a hook in
 * Phase 7's shared signal job (see the plan's Workflow 10B amendments).
 */
import type { DeviceIntegrityInput } from '@openverify/checks';
import { getInquiryIntegrityVerdict, inquiryIntegrityTokenTaken, type Db } from '@openverify/db';
import type { DeviceIntegrityProvider } from '../../ports.js';
import { failedProjection, integrityVerdictProjectionSchema } from './projection.js';

/** The facts of `inquiry` under the environment kind's bound provider (`null`: none bound). */
export async function deviceIntegritySignalsInput(
  db: Db,
  inquiry: { environmentId: string; id: string },
  provider: DeviceIntegrityProvider | null,
): Promise<DeviceIntegrityInput> {
  const stored = await getInquiryIntegrityVerdict(db, inquiry.environmentId, inquiry.id);
  const parsed =
    stored === null ? null : integrityVerdictProjectionSchema.safeParse(stored.verdict);
  return {
    provider: provider === null ? null : { name: provider.name, sandbox: provider.sandbox },
    tokenPending:
      stored === null && (await inquiryIntegrityTokenTaken(db, inquiry.environmentId, inquiry.id)),
    verdict:
      stored === null
        ? null
        : {
            provider: stored.provider,
            projection: parsed?.success === true ? parsed.data : failedProjection(stored.decodedAt),
          },
  };
}
