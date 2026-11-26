/**
 * C52.6, C54.1: the submit guards of the types whose builders have not landed yet. Each takes
 * only its own body member and needs the evidence the contracts already fix: a document's file,
 * a chip's SOD and data groups 1 and 2, a form type's entered values (`inputs_required`); a
 * silent AAMVA step is never submitted by the client (409 `verification_created_by_server`);
 * phone and email are submitted `confirmed`, or `initiated` once a limit refused the user
 * (C55.6, which `api-otp` builds). Each type's builder replaces its file's guard.
 */
import { Phase5ProblemError } from '../../errors.js';
import type { SubmitGuard } from './index.js';
import { standardSubmitGuard } from './standard.js';

/** The C59.6 refusal of a client submit of a silent AAMVA attempt. */
export function assertNotCreatedByServer(step: { type: string; source?: unknown } | undefined) {
  if (step?.type === 'aamva' && step.source === 'government_id') {
    throw new Phase5ProblemError(
      'verification_created_by_server',
      'This verification is created and submitted by the server.',
    );
  }
}

/** The AAMVA form's guard: its entered values; the silent source is the server's. */
export function aamvaSubmitGuard(): SubmitGuard {
  const form = standardSubmitGuard({ inputs: true });
  return {
    ...form,
    checkBody(ctx) {
      assertNotCreatedByServer(ctx.step);
      form.checkBody(ctx);
    },
  };
}
