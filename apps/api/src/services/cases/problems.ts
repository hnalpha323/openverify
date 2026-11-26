/**
 * C129.7 (Workflow 8B): a case problem with its code and the status `CASE_PROBLEM_STATUSES` gives it.
 * A pointer names the member at fault, never its value; no case problem carries a field value, a
 * comment, a filename or an address (Stage 1a amendment 13).
 */
import { CASE_PROBLEM_STATUSES, type CaseProblemCode } from '@openverify/contracts';
import { AppError, type ProblemFieldError, type ProblemMembers } from '../../errors.js';

export interface CaseProblemInit {
  errors?: readonly ProblemFieldError[];
  headers?: Record<string, string>;
  members?: ProblemMembers;
}

export class CaseProblemError extends AppError {
  override name = 'CaseProblemError';
  declare readonly code: CaseProblemCode;

  constructor(code: CaseProblemCode, detail: string, init: CaseProblemInit = {}) {
    const status = CASE_PROBLEM_STATUSES[code];
    super({
      status,
      ...(status === 422 ? { title: 'Unprocessable Content' } : {}),
      detail,
      code,
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(init.errors === undefined ? {} : { errors: init.errors }),
      ...(init.members === undefined ? {} : { members: init.members }),
    });
  }
}

/** A problem naming one member of the request by its JSON Pointer. */
export const caseProblemAt = (code: CaseProblemCode, detail: string, pointer: string) =>
  new CaseProblemError(code, detail, { errors: [{ location: 'body', pointer, detail }] });
