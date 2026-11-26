/**
 * C54.1, C59.4-C59.6: the `aamva` job. It reads the values of the attempt (`verification_inputs`:
 * entered on the AAMVA form, or copied from the inquiry's licence by the silent step), asks the
 * environment's AAMVA DLDV provider (C35) about the card's jurisdiction and those values, nothing
 * else, and runs the C59 evaluators of `@openverify/checks` on its verdict. An unbound provider is
 * `provider_not_configured`; a failed one is retried, then `execution_error` on the last attempt
 * (C30.3). No value is logged or written beyond the check results.
 *
 * A jurisdiction outside DLDV (C50.7, C59.5): the silent source, and the form source whose
 * template sets `on-jurisdiction-not-participating: skip`, move the verification
 * `submitted -> skipped` (`aamvaSkipsVerification`); otherwise the checks answer
 * `jurisdiction_not_participating` and it goes to review. The evaluation asks for the skip
 * (`TypeEvaluation.skip`), and the job writes it in its own decision transaction, with the checks
 * and `verification.skipped`, then runs the decision hooks and settles the inquiry.
 *
 * The silent step (C59.6, `onInquiryVerificationDecided`): the client never creates or submits
 * its attempts. In the decision transaction of every government ID decision of an inquiry whose
 * flow has an `aamva` step with `source: government_id`, after the ID's extraction is written:
 * - an eligible `passed` or `needs_review` decision ({@link aamvaValuesOfExtraction}) creates an
 *   attempt bound to that ID verification (`verification_inputs.source_verification_id`), with
 *   the values copied and re-sealed, moves it to `submitted` and has it enqueued after commit;
 *   also when the type's latest attempt was a server skip or is bound to an earlier ID;
 * - any other final decision (passed or reviewed on an ineligible document, or a failure with no
 *   ID attempt left or that no retry can fix) creates it `skipped`, bound likewise, so the same
 *   job's settlement settles the inquiry;
 * - a retryable ID failure with attempts left creates nothing (the ID step is not final), and an
 *   ID decision never creates a second attempt.
 * Nothing is created once the inquiry is decided.
 */
import { advanceFlowInTx, NO_FLOW_ADVANCE } from '../../flow-engine/advance.js';
import {
  AAMVA_VALUE_NAMES,
  aamvaIssuerOf,
  aamvaSkipsVerification,
  evaluateAamvaChecks,
  type AamvaCheckInput,
  type AamvaValues,
} from '@openverify/checks';
import {
  aamvaInputsSchema,
  newId,
  stepForVerificationType,
  stepMaxAttempts,
  type AamvaInputs,
} from '@openverify/contracts';
import { emptyExtractedFields, type ExtractedFields } from '@openverify/core';
import {
  copyVerificationInputs,
  createVerification,
  getGovernmentIdExtraction,
  getVerificationInputs,
  listInquiryVerifications,
  listVerificationInputSources,
  type Db,
  type GovernmentIdExtraction,
  type IdClassGroup,
} from '@openverify/db';
import type { AamvaLookupRequest } from '../../ports.js';
import { moveVerification, stageVerificationEvent } from '../../services/verifications.js';
import { isRetryableFailure } from '../inquiry-outcome.js';
import type { ProcessVerificationDeps } from '../process-verification.js';
import { askProvider, enablesAny } from './database.js';
import type {
  InquiryDecisionHookResult,
  InquiryVerificationDecidedContext,
  TypeEvaluationJob,
  VerificationTypeJob,
} from './index.js';

/** The AAMVA checks, all of which read the provider's verdict. */
const AAMVA_CHECKS = [
  'aamva_identity_comparison',
  'aamva_name_comparison',
  'aamva_identification_number_comparison',
] as const;

/** The values the evaluators read: text members only, by their body names. */
function aamvaValuesOf(values: Readonly<Record<string, unknown>> | null): AamvaValues | null {
  if (values === null) {
    return null;
  }
  return Object.fromEntries(
    AAMVA_VALUE_NAMES.flatMap((name) => {
      const value = values[name];
      return typeof value === 'string' ? [[name, value]] : [];
    }),
  );
}

/** C35: what DLDV is asked: the card's jurisdiction and its values as extraction fields. */
function lookupRequest(values: AamvaValues): AamvaLookupRequest {
  const fields: ExtractedFields = {
    ...emptyExtractedFields(),
    'name-first': values['name-first'] ?? null,
    'name-last': values['name-last'] ?? null,
    birthdate: values.birthdate ?? null,
    'identification-number': values['identification-number'] ?? null,
    'issue-date': values['issue-date'] ?? null,
    'expiration-date': values['expiration-date'] ?? null,
    'address-postal-code': values['address-postal-code'] ?? null,
  };
  return { jurisdiction: values['issuing-authority'] ?? null, fields };
}

async function aamvaInput(
  deps: ProcessVerificationDeps,
  job: TypeEvaluationJob,
): Promise<AamvaCheckInput> {
  const inputs = await getVerificationInputs(deps.db, job.environmentId, job.verificationId);
  const values = aamvaValuesOf(inputs?.values ?? null);
  const source = inputs?.source === 'government_id' ? 'government_id' : 'form';
  if (values === null || !enablesAny(job.config, AAMVA_CHECKS)) {
    return { values, source };
  }
  const request = lookupRequest(values);
  const aamva = await askProvider(
    deps.providers?.[job.environmentKind].aamva,
    (provider) => provider.lookup(request),
    {
      lastAttempt: job.lastAttempt,
      logger: deps.logger,
      log: { verificationId: job.verificationId, check: 'aamva_identity_comparison' },
    },
  );
  return { values, source, providers: { aamva } };
}

// C59.6: the silent step --------------------------------------------------------------------

/** The classes of an AAMVA card: a driver licence or an ID card, as the document established. */
const AAMVA_CLASSES: ReadonlySet<IdClassGroup> = new Set(['drivers_license', 'national_id']);

/** A US ZIP code as the AAMVA body writes it (`12345` or `12345-6789`), else nothing. */
function zipCodeOf(postalCode: string | null): string | undefined {
  const digits = postalCode?.replace(/\D/g, '') ?? '';
  if (digits.length === 5) {
    return digits;
  }
  return digits.length === 9 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : undefined;
}

/**
 * C59.6 `aamvaEligible`: the AAMVA values of a government ID whose class the document itself
 * established as a driver licence or ID card, issued by a US state or territory (the AAMVA issuer
 * its IIN names, from the barcode or the visual zone), and whose extraction holds every AAMVA
 * input (name, birth date, number); `null` for any other ID, or an extraction that is gone.
 */
export function aamvaValuesOfExtraction(
  extraction: GovernmentIdExtraction | null,
): AamvaInputs | null {
  const fields = extraction?.fields ?? null;
  if (extraction === null || fields === null || !AAMVA_CLASSES.has(extraction.idClassGroup)) {
    return null;
  }
  const iin = fields['issuing-authority-code'];
  const issuer = iin === null ? null : aamvaIssuerOf(iin);
  const candidate = {
    'name-first': fields['name-first'] ?? undefined,
    'name-last': fields['name-last'] ?? undefined,
    birthdate: fields.birthdate ?? undefined,
    'identification-number': fields['identification-number'] ?? undefined,
    'issuing-authority': issuer?.country === 'US' ? (issuer.code ?? undefined) : undefined,
    'issue-date': fields['issue-date'] ?? undefined,
    'expiration-date': fields['expiration-date'] ?? undefined,
    'address-postal-code': zipCodeOf(fields['address-postal-code']),
  };
  const parsed = aamvaInputsSchema.safeParse(
    Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined)),
  );
  return parsed.success ? parsed.data : null;
}

const NOTHING: InquiryDecisionHookResult = Object.freeze({ staged: [], enqueue: [] });

/** Whether a failed ID decision is final: no retry can fix it, or no attempt is left. */
async function finalFailure(tx: Db, ctx: InquiryVerificationDecidedContext): Promise<boolean> {
  if (!isRetryableFailure(ctx.decided.checks)) {
    return true;
  }
  const step = stepForVerificationType(ctx.flow, 'government_id');
  const failures = (await listInquiryVerifications(tx, ctx.environmentId, ctx.inquiry.id)).filter(
    (verification) =>
      verification.type === 'government_id' &&
      (verification.status === 'failed' || verification.status === 'canceled'),
  ).length;
  return step === undefined || failures >= stepMaxAttempts(step);
}

/** Whether an AAMVA attempt is already bound to the decided ID verification. */
async function alreadyBound(tx: Db, ctx: InquiryVerificationDecidedContext): Promise<boolean> {
  const attempts = (await listInquiryVerifications(tx, ctx.environmentId, ctx.inquiry.id)).filter(
    (verification) => verification.type === 'aamva',
  );
  const sources = await listVerificationInputSources(
    tx,
    ctx.environmentId,
    attempts.map(({ id }) => id),
  );
  return [...sources.values()].includes(ctx.decided.id);
}

/**
 * C59.6: the silent step's attempt for one government ID decision: created bound to it, then
 * `submitted` with the copied values, or `skipped` with none.
 */
async function createSilentAttempt(
  tx: Db,
  ctx: InquiryVerificationDecidedContext,
  values: AamvaInputs | null,
): Promise<InquiryDecisionHookResult> {
  const { deps, environmentId, inquiry, now } = ctx;
  const created = await createVerification(tx, environmentId, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'aamva',
  });
  await copyVerificationInputs(tx, environmentId, {
    verificationId: created.id,
    inquiryId: inquiry.id,
    values: values ?? {},
    sourceVerificationId: ctx.decided.id,
    at: now,
  });
  const staged = [
    await stageVerificationEvent(
      tx,
      deps.events,
      'verification.created',
      { ...created, checks: [] },
      [],
    ),
  ];
  const moved = await moveVerification(tx, created, values === null ? 'skipped' : 'submitted', now);
  if (moved?.event == null) {
    throw new Error('the silent AAMVA attempt did not move from initiated');
  }
  staged.push(
    await stageVerificationEvent(
      tx,
      deps.events,
      moved.event,
      { ...moved.verification, checks: [] },
      [],
    ),
  );
  // C151.2 (Workflow 9A Stage 1b (S)): a silent attempt skipped here is decided in this transaction,
  // so it is its step's exit too (`advanceFlowInTx`, `api-flow-engine`).
  const advanced =
    values === null
      ? await advanceFlowInTx(
          tx,
          deps,
          { environmentId, inquiryId: inquiry.id },
          {
            kind: 'verification-decided',
            verificationId: created.id,
            verificationType: 'aamva',
            status: 'skipped',
            origin: 'flow',
          },
        )
      : NO_FLOW_ADVANCE;
  staged.push(...advanced.staged);
  return {
    staged,
    enqueue: values === null ? [] : [{ environmentId, verificationId: created.id }],
    flowAfter: [...advanced.after],
  };
}

/** C59.6: the hook every decision of the inquiry runs, in its decision transaction. */
async function onGovernmentIdDecided(
  tx: Db,
  ctx: InquiryVerificationDecidedContext,
): Promise<InquiryDecisionHookResult> {
  const step = stepForVerificationType(ctx.flow, 'aamva');
  if (
    ctx.decided.type !== 'government_id' ||
    step?.type !== 'aamva' ||
    step.source !== 'government_id' ||
    (ctx.inquiryStatus !== 'created' && ctx.inquiryStatus !== 'pending')
  ) {
    return NOTHING;
  }
  const { status } = ctx.decided;
  if (status !== 'passed' && status !== 'needs_review' && status !== 'failed') {
    return NOTHING;
  }
  if ((status === 'failed' && !(await finalFailure(tx, ctx))) || (await alreadyBound(tx, ctx))) {
    return NOTHING;
  }
  const values =
    status === 'failed'
      ? null
      : aamvaValuesOfExtraction(
          await getGovernmentIdExtraction(tx, ctx.environmentId, ctx.decided.id),
        );
  return createSilentAttempt(tx, ctx, values);
}

export const aamvaJob: VerificationTypeJob<null> = {
  type: 'aamva',
  runnable: true,
  async evaluate(deps, job) {
    const input = await aamvaInput(deps, job);
    return {
      results: evaluateAamvaChecks(input, job.config),
      state: null,
      skip: aamvaSkipsVerification(input, job.config),
    };
  },
  persistInDecisionTx: (_tx, ctx) => ctx.verificationEvent(),
  onProcessingFailed: () => Promise.resolve([]),
  onInquiryVerificationDecided: onGovernmentIdDecided,
};
