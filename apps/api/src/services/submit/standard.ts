/**
 * C52.6, C54.1: the submit guard most types share, and the rules a type's guard composes:
 * the body may carry only the type's own member, the step's required files must be stored
 * (`requiredFileKinds`), and a form type's entered values must have been sent (409
 * `inputs_required`).
 */
import {
  requiredFileKinds,
  toApiVerificationType,
  type FlowSubmitVerificationBody,
} from '@openverify/contracts';
import { isVerificationStep } from '@openverify/contracts';
import { getVerificationInputs, type VerificationStatus } from '@openverify/db';
import { Phase5ProblemError, UnprocessableContentError } from '../../errors.js';
import type { SubmitBodyContext, SubmitContext, SubmitGuard, SubmitPreparation } from './index.js';

/** The members of a submit body, and the noun a refusal names each by. */
const MEMBERS = {
  capture: 'selfie capture',
  crypto: 'crypto signature',
  chip: 'chip data',
} as const satisfies Record<keyof FlowSubmitVerificationBody, string>;

/**
 * Refuses (422) every body member but `own`: a selfie's `capture`, a crypto wallet's `crypto`, an
 * NFC chip's `chip`.
 */
export function assertOnlyMember(
  ctx: SubmitBodyContext,
  own?: keyof FlowSubmitVerificationBody,
): void {
  for (const [member, noun] of Object.entries(MEMBERS)) {
    if (member !== own && ctx.body?.[member as keyof FlowSubmitVerificationBody] !== undefined) {
      throw new UnprocessableContentError(
        `A ${toApiVerificationType(ctx.verification.type)} verification takes no ${noun}.`,
      );
    }
  }
}

/** The step's required files (C52.4), all stored, or 422 naming the missing kinds. */
export function assertRequiredFiles(ctx: SubmitContext): void {
  const required = isVerificationStep(ctx.step) ? requiredFileKinds(ctx.step) : [];
  const missing = required.filter((kind) => !ctx.files.some((file) => file.kind === kind));
  if (missing.length > 0) {
    throw new UnprocessableContentError(`Missing required files: ${missing.join(', ')}.`);
  }
}

/** C52.6: a form type's values were entered (`POST /verifications/:id/inputs`), or 409. */
export async function assertInputsReceived(ctx: SubmitContext): Promise<void> {
  const inputs = await getVerificationInputs(
    ctx.tx,
    ctx.verification.environmentId,
    ctx.verification.id,
  );
  if (inputs === null) {
    throw new Phase5ProblemError(
      'inputs_required',
      'The verification needs its entered values before it can be submitted.',
    );
  }
}

export interface StandardSubmitOptions {
  /** The body member the type takes, if any. */
  member?: keyof FlowSubmitVerificationBody;
  /** Defaults to `initiated` only. */
  statuses?: readonly VerificationStatus[];
  /** C52.6: a form type needs its entered values. */
  inputs?: boolean;
}

/** The standard guard: the type's own member only, its required files, and for a form its values. */
export function standardSubmitGuard(options: StandardSubmitOptions = {}): SubmitGuard {
  return {
    submittableStatuses: options.statuses ?? ['initiated'],
    checkBody: (ctx) => {
      assertOnlyMember(ctx, options.member);
    },
    async inTransaction(ctx): Promise<SubmitPreparation> {
      assertRequiredFiles(ctx);
      if (options.inputs === true) {
        await assertInputsReceived(ctx);
      }
      return { files: ctx.files, staged: [] };
    },
    repeat: () => Promise.resolve(),
  };
}
