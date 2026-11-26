/**
 * Test helpers for the inquiry services and routes. Only tests import this file.
 *
 * Every inquiry belongs to an account (C13), and the inquiries table refuses an account id that
 * does not exist. The harness's default `AccountsService` fake writes no account rows, so the
 * inquiry tests use {@link createDbAccountsService}: the C13 resolution order on the real
 * account rows (`resolveInquiryAccount`), recording each call like the fake does.
 */
import { resolveInquiryAccount } from '@openverify/db';
import { NotFoundError } from '../errors.js';
import type { AccountsService, ResolveInquiryAccountInput, ServiceContext } from '../ports.js';
import { createTestApi, type TestApi } from '../test-support/harness.js';
import type { ApiDependencies } from './context.js';

export interface DbAccountsService extends AccountsService {
  /** Every `resolveForInquiry` call, oldest first. */
  readonly calls: { ctx: ServiceContext; input: ResolveInquiryAccountInput }[];
  /** Makes the next call reject with `error`. */
  failNext(error: Error): void;
}

/** `AccountsService.resolveForInquiry` on the account rows, as api-lifecycle's service resolves. */
export function createDbAccountsService(): DbAccountsService {
  const calls: DbAccountsService['calls'] = [];
  let failure: Error | undefined;
  return {
    calls,
    failNext(error) {
      failure = error;
    },
    async resolveForInquiry(tx, ctx, input) {
      calls.push({ ctx: { ...ctx }, input: { ...input } });
      if (failure !== undefined) {
        const error = failure;
        failure = undefined;
        throw error;
      }
      const accountId = await resolveInquiryAccount(tx, ctx.environmentId, input);
      if (accountId === null) {
        throw new NotFoundError(`Account ${String(input.accountId)} was not found.`);
      }
      return accountId;
    },
  };
}

export interface InquiryTestApi extends TestApi {
  /** The accounts service the app was built with. */
  dbAccounts: DbAccountsService;
}

/** The test harness with database-backed account resolution, plus any other overrides. */
export async function createInquiryTestApi(
  overrides: Partial<ApiDependencies> = {},
): Promise<InquiryTestApi> {
  const dbAccounts = createDbAccountsService();
  const api = await createTestApi({ accounts: dbAccounts, ...overrides });
  return Object.assign(api, { dbAccounts });
}
