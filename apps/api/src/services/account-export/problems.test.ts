/**
 * C253 (Workflow 11B, `dsar-export`): each problem as its golden states it (the `instance` and the
 * `requestId` are the request's), generic toward the caller (rule 11).
 */
import { readFileSync } from 'node:fs';
import { ACCOUNT_EXPORT_PROBLEM_STATUSES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import type { AppError } from '../../errors.js';
import {
  accountExportItemRedacted,
  accountExportPending,
  accountExportTooLarge,
  accountExportUnavailable,
} from './problems.js';

const golden = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../../../contracts/fixtures/problems/account-exports/${name}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;

const asProblem = (error: AppError) => ({
  type: error.type,
  title: error.title,
  status: error.status,
  detail: error.message,
  code: error.code,
  ...error.members,
});

describe('the access export problems (C253)', () => {
  it.each([
    ['account-export-pending', accountExportPending()],
    ['account-export-too-large', accountExportTooLarge(5001)],
    ['account-export-item-redacted', accountExportItemRedacted()],
    ['account-export-unavailable', accountExportUnavailable()],
  ])('%s is its golden', (name, error) => {
    const expected = Object.fromEntries(
      Object.entries(golden(name)).filter(([key]) => key !== 'instance' && key !== 'requestId'),
    );
    expect(asProblem(error)).toEqual(expected);
    expect(error.status).toBe(
      ACCOUNT_EXPORT_PROBLEM_STATUSES[
        expected.code as keyof typeof ACCOUNT_EXPORT_PROBLEM_STATUSES
      ],
    );
  });
});
