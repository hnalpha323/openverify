/**
 * Workflow 11A Stage 1b (C): Connect's problems by their frozen codes (`CONNECT_PROBLEM_STATUSES`,
 * `packages/contracts/src/problem.ts`; one golden each under `contracts/fixtures/problems/connect/`).
 * The status follows the code, so no caller re-declares one (rule 20(g)). Details never carry a
 * shared value, a consent's evidence or a token of any kind (rule 11).
 */
import { CONNECT_PROBLEM_STATUSES, type ConnectProblemCode } from '@openverify/contracts';
import { AppError, type ProblemFieldError } from '../../errors.js';

export class ConnectProblemError extends AppError {
  override name = 'ConnectProblemError';

  constructor(
    code: ConnectProblemCode,
    detail: string,
    extra: { errors?: readonly ProblemFieldError[]; reason?: string } = {},
  ) {
    super({
      status: CONNECT_PROBLEM_STATUSES[code],
      detail,
      code,
      ...(extra.errors === undefined ? {} : { errors: extra.errors }),
      ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    });
  }
}
