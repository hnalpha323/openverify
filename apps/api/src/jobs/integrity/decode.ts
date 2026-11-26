/**
 * C211.4 (Workflow 10B; the `integrity-decode` job). Owner: `api-integrity`; the signature and the
 * worker's registration were placed by `foundation-10b` (Stage 1b (I)).
 *
 * For one challenge:
 * 1. read its posted token in place (`readInquiryIntegrityToken`); none: skipped;
 * 2. an inquiry redacted after its token was posted (owner decision 5 after Workflow 6C), or an
 *    environment kind that binds no `deviceIntegrity` provider any more: the token is taken and
 *    nothing is written;
 * 3. decode it through the bound provider (Google's `decodeIntegrityToken` through the outbound
 *    client, 15 s, no redirects; or the sandbox's magic tokens), which checks the package name, the
 *    request hash, the timestamp within 10 minutes, the app recognition and the certificate digest
 *    and answers C211.4's projection only. A failure that may pass (the network, a timeout, a 5xx or
 *    429) fails the attempt with the token kept, so BullMQ retries it (`INTEGRITY_DECODE_JOB_OPTIONS`);
 *    any other failure, or an answer outside the projection's schema, is a failed decode, which the
 *    signals read as `integrity_decode_failed`;
 * 4. under the inquiry's lock, unless it was redacted meanwhile, store the projection (one per
 *    inquiry, sealed for its row) and take the token, in one transaction.
 *
 * Only codes are logged: never the token, the request hash or a member of the verdict.
 */
import {
  getEnvironment,
  getInquiry,
  lockInquiry,
  readInquiryIntegrityToken,
  storeInquiryIntegrityVerdict,
  takeInquiryIntegrityToken,
  type Db,
  type Keyring,
} from '@openverify/db';
import type { OutboundHttp } from '../../http/index.js';
import type { Clock, IntegrityDecodeJob, ProviderBindings } from '../../ports.js';
import { DeviceIntegrityDecodeError } from '../../services/device-integrity/errors.js';
import {
  failedProjection,
  integrityVerdictProjectionSchema,
  type IntegrityVerdictProjection,
} from '../../services/device-integrity/projection.js';
import type { WorkerLogger } from '../logger.js';

/** What the job reads. */
export interface IntegrityDecodeDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  keyring: Keyring;
  /** The worker's bindings: the environment kind's `deviceIntegrity` provider decodes. */
  providers?: ProviderBindings | undefined;
  /** C211.4: the outbound client (15 s, no redirects) the `play-integrity` provider calls through. */
  outboundHttp?: OutboundHttp | undefined;
}

/** What one job did. */
export interface IntegrityDecodeResult {
  outcome: 'decoded' | 'skipped';
}

export type ProcessIntegrityDecode = (
  job: IntegrityDecodeJob,
  deps: IntegrityDecodeDeps,
) => Promise<IntegrityDecodeResult>;

const SKIPPED: IntegrityDecodeResult = { outcome: 'skipped' };

/** A decode that may pass on another attempt: the job fails with its code only. */
export class IntegrityDecodeRetryError extends Error {
  override name = 'IntegrityDecodeRetryError';

  constructor(readonly code: string) {
    super(`the integrity decode will be retried (${code})`);
  }
}

/** The provider's projection, or a failed decode; a decode that may pass is thrown to be retried. */
async function decodeOrFail(
  decode: () => Promise<unknown>,
  deps: IntegrityDecodeDeps,
  job: IntegrityDecodeJob,
): Promise<IntegrityVerdictProjection> {
  let answer: unknown;
  try {
    answer = await decode();
  } catch (error) {
    const code = error instanceof DeviceIntegrityDecodeError ? error.code : 'decode_failed';
    if (error instanceof DeviceIntegrityDecodeError && error.retryable) {
      throw new IntegrityDecodeRetryError(code);
    }
    deps.logger.warn(
      { code, environmentId: job.environmentId, challengeId: job.challengeId },
      'integrity decode failed',
    );
    return failedProjection(deps.clock.now());
  }
  const parsed = integrityVerdictProjectionSchema.safeParse(answer);
  if (!parsed.success) {
    deps.logger.warn(
      {
        code: 'projection_refused',
        environmentId: job.environmentId,
        challengeId: job.challengeId,
      },
      'integrity decode failed',
    );
    return failedProjection(deps.clock.now());
  }
  return parsed.data;
}

export const processIntegrityDecode: ProcessIntegrityDecode = async (job, deps) => {
  const { db } = deps;
  const { environmentId, challengeId } = job;
  const posted = await readInquiryIntegrityToken(db, environmentId, challengeId);
  if (posted === null) {
    return SKIPPED;
  }
  const environment = await getEnvironment(db, environmentId);
  const inquiry = await getInquiry(db, environmentId, posted.inquiryId);
  const provider =
    environment === null ? undefined : deps.providers?.[environment.kind].deviceIntegrity;
  if (inquiry?.redactedAt !== null || provider === undefined) {
    await takeInquiryIntegrityToken(db, environmentId, challengeId);
    return SKIPPED;
  }
  const projection = await decodeOrFail(
    () => provider.decode({ token: posted.token, requestHash: posted.requestHash }),
    deps,
    job,
  );
  const stored = await db.transaction(async (tx) => {
    await lockInquiry(tx, environmentId, posted.inquiryId);
    const current = await getInquiry(tx, environmentId, posted.inquiryId);
    if (current?.redactedAt === null) {
      await storeInquiryIntegrityVerdict(tx, environmentId, {
        inquiryId: posted.inquiryId,
        provider: provider.name,
        verdict: { ...projection },
        decodedAt: new Date(projection['decoded-at']),
      });
    }
    await takeInquiryIntegrityToken(tx, environmentId, challengeId);
    return current?.redactedAt === null;
  });
  return stored ? { outcome: 'decoded' } : SKIPPED;
};
