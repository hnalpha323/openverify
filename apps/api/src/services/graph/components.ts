/**
 * C101.6 (owner decision 6 after Workflow 7B): `GET /accounts/:id/graph-component`. The nightly job
 * writes `graph_components`; this answers one account's row in words: `disabled` while the
 * environment's `graph-components` is off, whatever a past run left; `not-computed` when it is on
 * and the account has no row, being newer than the last run or redacted; `computed` otherwise. The
 * run-local component id is never served, and the size is advisory (beta).
 */
import type { AccountGraphComponentDocument } from '@openverify/contracts';
import { getEnvironment, getGraphComponent } from '@openverify/db';
import type { ApiDependencies } from '../context.js';
import { getAccountView } from '../accounts.js';
import { graphSettingsOf } from './settings.js';

const UNCOMPUTED = { size: null, 'computed-at': null } as const;

/** @throws {NotFoundError} when the account is not in this environment. */
export async function getAccountGraphComponentDocument(
  deps: ApiDependencies,
  environmentId: string,
  accountId: string,
): Promise<AccountGraphComponentDocument> {
  await getAccountView(deps, environmentId, accountId);
  const resource = { type: 'account-graph-component', id: accountId } as const;
  const environment = await getEnvironment(deps.db, environmentId);
  if (environment === null || !graphSettingsOf(environment).components) {
    return { data: { ...resource, attributes: { state: 'disabled', ...UNCOMPUTED } } };
  }
  const row = await getGraphComponent(deps.db, environmentId, accountId);
  return {
    data: {
      ...resource,
      attributes:
        row === null
          ? { state: 'not-computed', ...UNCOMPUTED }
          : {
              state: 'computed',
              size: row.size,
              'computed-at': row.computedAt.toISOString(),
            },
    },
  };
}
