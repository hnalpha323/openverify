/**
 * C160.4, C160.6, C160.7, C174.8 (`api-themes`, Workflow 9B): a problem of `THEME_PROBLEM_STATUSES`
 * with its code and status. `theme_contrast_insufficient` carries `pairs[]` (each failing pair by
 * its tokens and the pointer of its foreground cell, the ratio never rounded), never a colour.
 */
import {
  THEME_PROBLEM_STATUSES,
  type ThemeContrastProblem,
  type ThemeProblemCode,
} from '@openverify/contracts';
import { AppError, type ProblemFieldError, type ProblemMembers } from '../../errors.js';

export type ThemeContrastPair = ThemeContrastProblem['pairs'][number];

export class ThemeProblemError extends AppError {
  override name = 'ThemeProblemError';
  declare readonly code: ThemeProblemCode;

  constructor(
    code: ThemeProblemCode,
    detail: string,
    init: { pairs?: readonly ThemeContrastPair[]; errors?: readonly ProblemFieldError[] } = {},
  ) {
    const status = THEME_PROBLEM_STATUSES[code];
    super({
      status,
      ...(status === 422 ? { title: 'Unprocessable Content' } : {}),
      detail,
      code,
      ...(init.errors === undefined ? {} : { errors: init.errors }),
      // `pairs` is a list of records, which the shared `ProblemMembers` type does not name; the
      // problem writer spreads members as they are (a contractDeviation for `errors.ts`).
      ...(init.pairs === undefined
        ? {}
        : { members: { pairs: init.pairs } as unknown as ProblemMembers }),
    });
  }
}
