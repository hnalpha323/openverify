/**
 * C253 (Workflow 11B, `dsar-export`): the access export's problems by their frozen codes
 * (`ACCOUNT_EXPORT_PROBLEM_STATUSES`; one golden each under
 * `contracts/fixtures/problems/account-exports/`). Generic toward the caller (rule 11): no detail
 * names the account's data, only the counts of a refusal past the item limit.
 */
import {
  ACCOUNT_EXPORT_LIMITS,
  ACCOUNT_EXPORT_PROBLEM_STATUSES,
  type AccountExportProblemCode,
} from '@openverify/contracts';
import { AppError, type AppErrorInit } from '../../errors.js';

function problem(
  code: AccountExportProblemCode,
  detail: string,
  extra: Pick<AppErrorInit, 'members' | 'title'> = {},
): AppError {
  return new AppError({ status: ACCOUNT_EXPORT_PROBLEM_STATUSES[code], detail, code, ...extra });
}

/** 409: one export of the account is still being prepared (C253.5). */
export const accountExportPending = (): AppError =>
  problem('account_export_pending', 'An export of this account is already being prepared.');

/** 422: the account holds more items than one export lists, with the counts (C253.5). */
export const accountExportTooLarge = (itemCount: number): AppError =>
  problem('account_export_too_large', 'The account holds more items than one export may list.', {
    // RFC 9110's name, as `exportProblem` and the golden have it.
    title: 'Unprocessable Content',
    members: { 'item-count': itemCount, 'item-limit': ACCOUNT_EXPORT_LIMITS.items },
  });

/** 410: a listed file was redacted after the export was prepared (C253.2). */
export const accountExportItemRedacted = (): AppError =>
  problem('account_export_item_redacted', 'This file was redacted after the export was prepared.');

/** 503: the `account-export` policy's store did not answer (C253.7). */
export const accountExportUnavailable = (): AppError =>
  problem(
    'account_export_unavailable',
    'Account exports are unavailable for the moment. Try again shortly.',
  );
