/**
 * What the object actions share: the dependencies, a rendered config parsed by its entry, and a
 * service's refusal as a step error. A `transaction` handler that has written and cannot go on throws
 * {@link ActionStepError}, so nothing it wrote commits (C117.5); a code is never a value (C120.2).
 */
import type { z } from 'zod';
import {
  AppError,
  InvalidTransitionError,
  NotFoundError,
  RateLimitedError,
  RedactedError,
} from '../../errors.js';
import type { ApiDependencies } from '../../services/context.js';
import { ActionStepError, type ActionContext, type ActionResult } from '../engine/action-port.js';

/** The `…InTx` forms are typed by `ApiDependencies`; what they read is `WorkflowServices` (F11). */
export const apiDepsOf = (context: Pick<ActionContext, 'services'>): ApiDependencies =>
  context.services as unknown as ApiDependencies;

/** The rendered config, as its entry reads it, defaults applied. */
export function configOf<Schema extends z.ZodType>(
  context: Pick<ActionContext, 'config'>,
  schema: Schema,
): z.output<Schema> {
  const parsed = schema.safeParse(context.config);
  if (!parsed.success) {
    throw new ActionStepError('action_input_invalid');
  }
  return parsed.data;
}

function retryAfterOf(error: RateLimitedError): number | undefined {
  const value = Number(error.headers['retry-after']);
  return Number.isFinite(value) ? value : undefined;
}

/** A service's refusal as the step's error; `null` for what is no refusal, which stays a bug. */
export function stepErrorOf(error: unknown): ActionStepError | null {
  if (error instanceof ActionStepError) {
    return error;
  }
  if (error instanceof NotFoundError) {
    return new ActionStepError('object_not_found');
  }
  if (error instanceof RedactedError) {
    return new ActionStepError('subject_redacted');
  }
  if (error instanceof InvalidTransitionError) {
    return new ActionStepError('invalid_transition');
  }
  if (error instanceof RateLimitedError) {
    // Outcome 27: a shared budget is no failed run and no result: the step retries.
    const seconds = retryAfterOf(error);
    return new ActionStepError('rate_limited', {
      retryable: true,
      ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }),
    });
  }
  if (error instanceof AppError) {
    return new ActionStepError(error.code ?? 'action_refused');
  }
  return null;
}

/** Runs `work`, and turns a service's refusal into its step error. */
export async function refusing<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    throw stepErrorOf(error) ?? error;
  }
}

/** The same, for an `outside` handler, where a step error is an answer. */
export async function answering(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await work();
  } catch (error) {
    const refusal = stepErrorOf(error);
    if (refusal === null) {
      throw error;
    }
    return { kind: 'failed', code: refusal.code, ...refusal.options };
  }
}
