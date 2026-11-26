/**
 * The shared parts of the provider-backed report jobs (`api-providers`, Workflow 6A Stage 3):
 * `email-address`, `phone-number`, `address-lookup`, `adverse-media` and `business-adverse-media`.
 *
 * - **Failures** (C69.4, C74.1). A lookup a retry may cure (a DNS timeout, a provider's 429 or
 *   5xx) is thrown while BullMQ attempts remain, so the framework releases the claim and the job
 *   runs again. On the last attempt the partial types record it themselves (the field `null` with
 *   `execution_error`, the report `ready`), because a thrown error would end the whole report
 *   `errored`; the media types end `errored` with `provider_error`.
 * - **OTP confirmation** (C82.1, C82.2, P05). Deliverability and reachability are read only for a
 *   report an inquiry's completion created, and only from that inquiry's confirmed codes, so no
 *   API caller can test guessed addresses or numbers against an inquiry's confirmed one.
 */
import type { ContactConfirmation, ProviderOutcome } from '@openverify/checks';
import type { ReportErrorCode } from '@openverify/core';
import {
  listInquiryVerifications,
  listOtpChallenges,
  openOtpChallengeDestination,
} from '@openverify/db';
import { DnsResolverError } from '../../dns/index.js';
import { REPORT_RUN_JOB_OPTIONS } from '../report-queues.js';
import { ProviderError } from '../../providers/errors.js';
import type { ProviderIdentity } from '../../ports.js';
import type { ReportRunContext, ReportRunResult } from './job.js';

/**
 * C74.1: whether this claim is the run's last BullMQ attempt. A claim counts once per attempt (a
 * budget wait gives its claim back uncounted), and a claim past the job's attempts comes from the
 * sweep's crash recovery, which BullMQ does not retry either.
 */
export function isLastReportAttempt(ctx: ReportRunContext): boolean {
  return ctx.run.attempt >= REPORT_RUN_JOB_OPTIONS.attempts;
}

/**
 * A lookup's failure: thrown again while a retry may cure it and attempts remain; otherwise
 * recorded (`{ kind: 'error' }`). Anything that is not a lookup failure is a defect: thrown.
 */
export function recordedFailure(ctx: ReportRunContext, error: unknown): { kind: 'error' } {
  if (!(error instanceof DnsResolverError || error instanceof ProviderError)) {
    throw error;
  }
  if (error.retryable && !isLastReportAttempt(ctx)) {
    throw error;
  }
  return { kind: 'error' };
}

/** A provider's answer as risk-logic's `ProviderOutcome`, or its failure (see above). */
export async function providerOutcome<Provider extends ProviderIdentity, Result>(
  ctx: ReportRunContext,
  provider: Provider | undefined,
  ask: (provider: Provider) => Promise<Result>,
): Promise<ProviderOutcome<Result>> {
  if (provider === undefined) {
    return { kind: 'not_configured' };
  }
  try {
    const result = await ask(provider);
    return { kind: 'result', provider: { id: provider.id, sandbox: provider.sandbox }, result };
  } catch (error) {
    return recordedFailure(ctx, error);
  }
}

/** The provider the result names (ADR 0002 §3d): the one that answered, else `null`. */
export function answeringProvider(
  outcome: ProviderOutcome<unknown>,
): { id: string; sandbox: boolean } | null {
  return outcome.kind === 'result' ? { ...outcome.provider } : null;
}

/**
 * C82.1, C82.2 (P05): `confirmed` when the report's inquiry holds a confirmed code of `type` whose
 * destination `matches`; `not_confirmed` for any other completion report; `not_linked` for every
 * other origin, whatever inquiry it names.
 */
export async function contactConfirmationOf(
  ctx: ReportRunContext,
  type: 'email_address' | 'phone_number',
  matches: (destination: string) => boolean,
): Promise<ContactConfirmation> {
  const { report, deps } = ctx;
  if (report.origin !== 'inquiry_completion' || report.inquiryId === null) {
    return 'not_linked';
  }
  const verifications = await listInquiryVerifications(
    deps.db,
    report.environmentId,
    report.inquiryId,
  );
  for (const verification of verifications) {
    if (verification.type !== type) {
      continue;
    }
    const challenges = await listOtpChallenges(deps.db, report.environmentId, verification.id);
    for (const challenge of challenges) {
      if (challenge.status !== 'confirmed') {
        continue;
      }
      const destination = await openOtpChallengeDestination(
        deps.db,
        report.environmentId,
        challenge.id,
      );
      if (destination !== null && matches(destination)) {
        return 'confirmed';
      }
    }
  }
  return 'not_confirmed';
}

/** A run that answers nothing but `code` (C69.3): nothing computed, nothing listed as screened. */
export function erroredResult(
  code: ReportErrorCode,
  extra: Partial<ReportRunResult> = {},
): ReportRunResult {
  return {
    errors: [{ code }],
    sources: [],
    coverage: null,
    result: {},
    unavailableFields: [],
    provider: null,
    thresholds: null,
    notices: [],
    matcherVersion: null,
    matches: [],
    ...extra,
  };
}
