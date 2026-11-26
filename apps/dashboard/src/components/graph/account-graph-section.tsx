/**
 * The account page's graph slot (C108, F32). `dashboard-signals` created this stub with its props
 * frozen; `dashboard-graph` owns the file and fills the body: direct connections from a chosen
 * template with `account_id` bound, run only by an explicit action, and "open in explorer".
 *
 * The account page calls it as a function and awaits it, so it may be async and read the API
 * itself (`getApiClient()`); it is called only for a principal holding `graph:read`. The page puts
 * what it returns inside its "Graph" section, shows that section's forbidden panel when the call
 * throws the API's 403, and leaves the section out when it returns `null`.
 *
 * It also shows the account's component size (C101.6, K7B-2-console), read on every render because
 * the route is a plain read, unlike a query run.
 */
import type { Permission } from '@openverify/core';
import type { ReactNode } from 'react';
import { expandAroundAccount } from '../../app/graph/actions';
import { getApiClient } from '../../lib/api/client';
import { AccountGraphComponent } from './account-graph-component';
import { AccountGraphPanel } from './account-graph-panel';

export interface AccountGraphSectionProps {
  /** The account, `acc_…`. */
  readonly accountId: string;
  /** The principal's permissions, as `GET /dashboard/me` answered them. */
  readonly permissions: ReadonlySet<Permission>;
}

/** How many templates' published versions are read to find those that bind `account_id`. */
const TEMPLATES_READ = 20;

/** The section's content, or `null` for none. */
export const AccountGraphSection: (props: AccountGraphSectionProps) => Promise<ReactNode> = async ({
  accountId,
  permissions,
}) => {
  const api = await getApiClient();
  const [{ data }, component] = await Promise.all([
    api.graphQueryTemplates.list({
      filter: { status: ['active'] },
      page: { size: TEMPLATES_READ },
    }),
    api.accounts.graphComponent(accountId),
  ]);
  const published = data.filter(
    (template) => template.relationships['published-version'].data !== null,
  );
  const versions = await Promise.all(
    published.map((template) =>
      api.graphQueryTemplates.versions.retrieve(
        template.relationships['published-version'].data?.id ?? '',
      ),
    ),
  );
  const templates = published
    .filter((_template, index) =>
      versions[index]?.data.attributes.config.parameters.some(
        (parameter) => parameter.kind === 'account_id',
      ),
    )
    .map((template) => ({ id: template.id, name: template.attributes.name }));
  return (
    <div className="flex flex-col gap-4">
      <AccountGraphComponent component={component.data} />
      <AccountGraphPanel
        accountId={accountId}
        templates={templates}
        canRun={permissions.has('graph:write')}
        action={expandAroundAccount}
      />
    </div>
  );
};
