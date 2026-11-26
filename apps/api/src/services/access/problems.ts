/**
 * The access problems of C167.2 and C168.1 (Phase 9, Workflow 9B; contracts B7): RFC 9457 documents
 * with `type` `about:blank`, the status `ACCESS_PROBLEM_STATUSES` gives the code, and the code as the
 * `code` member, as the golden problems in `contracts/fixtures/problems/access/` show them. Never
 * personal data: no address, email or permission held by someone else.
 */
import { ACCESS_PROBLEM_STATUSES, type AccessProblemCode } from '@openverify/contracts';
import { AppError, type ProblemFieldError } from '../../errors.js';

export class AccessProblemError extends AppError {
  override name = 'AccessProblemError';
  declare readonly code: AccessProblemCode;

  constructor(code: AccessProblemCode, detail: string, errors?: readonly ProblemFieldError[]) {
    const status = ACCESS_PROBLEM_STATUSES[code];
    super({
      status,
      ...(status === 422 ? { title: 'Unprocessable Content' } : {}),
      detail,
      code,
      ...(errors === undefined ? {} : { errors }),
    });
  }
}

/** 403 `no_environment_role` (C167.2, review F29): the user holds no role it may use there. */
export const noEnvironmentRole = (detail = 'You hold no role in this environment.') =>
  new AccessProblemError('no_environment_role', detail);
