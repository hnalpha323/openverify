import {
  SHARE_TOKEN_DIRECTIONS,
  SHARE_TOKEN_STATUSES,
  idSchema,
  type ShareTokenDirection,
  type ShareTokenStatus,
} from '@openverify/contracts';
import { Alert, Button } from '@openverify/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  listShareTokens,
  type ShareTokenFilters,
  type ShareTokensPage as TokensPage,
} from '../../../../components/connect/connect-api';
import { CONNECT_SETTINGS_PATH } from '../../../../components/connect/connections-table';
import { SHARE_TOKEN_STATUS_WORDS } from '../../../../components/connect/connect-words';
import {
  SHARE_TOKENS_PATH,
  ShareTokensTable,
} from '../../../../components/connect/share-tokens-table';
import { FormField } from '../../../../components/form-field';
import { LINK_CLASS } from '../../../../components/link-styles';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { classifyApiError } from '../../../../lib/api/errors';
import { renderPage } from '../../../../lib/api/page';
import { parseCursor } from '../../../../lib/list-query';

export const metadata: Metadata = { title: 'Share tokens' };

export interface ShareTokensPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const SELECT_CLASS =
  'rounded-lg border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const oneOf = <Value extends string>(
  values: readonly Value[],
  value: unknown,
): Value | undefined =>
  typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as Value)
    : undefined;

/** The filters a query names; a value the API would refuse is dropped. */
function filtersOf(query: Record<string, string | string[] | undefined>): ShareTokenFilters {
  const connection = query['connection-id'];
  return {
    direction: oneOf<ShareTokenDirection>(SHARE_TOKEN_DIRECTIONS, query.direction),
    status: oneOf<ShareTokenStatus>(SHARE_TOKEN_STATUSES, query.status),
    connectionId: idSchema('cxn').safeParse(connection).success
      ? (connection as string)
      : undefined,
  };
}

/** The list's own URL with `filters` and the cursor `after`. */
function hrefOf(filters: ShareTokenFilters, after: string): string {
  const query = new URLSearchParams();
  for (const [name, value] of [
    ['direction', filters.direction],
    ['status', filters.status],
    ['connection-id', filters.connectionId],
    ['after', after],
  ] as const) {
    if (value !== undefined) {
      query.set(name, value);
    }
  }
  return `${SHARE_TOKENS_PATH}?${query.toString()}`;
}

/** The page, or `null` while the installation's switch is off (the one 404, C231.10). */
async function tokensOrOff(filters: ShareTokenFilters, after?: string): Promise<TokensPage | null> {
  try {
    return await listShareTokens(filters, after);
  } catch (error) {
    if (classifyApiError(error) === 'not-found') {
      return null;
    }
    throw error;
  }
}

/**
 * C242.2: the share tokens of this environment in both directions (the outbound ones it created and
 * the inbound ones whose destination it is), filtered by direction, status and connection. A list
 * never carries a peek (C232.2).
 */
export default async function ShareTokensPage({ searchParams }: ShareTokensPageProps) {
  const query = await searchParams;
  const filters = filtersOf(query);
  const after = parseCursor(query.after, 'cnst');
  const filtered = Object.values(filters).some((value) => value !== undefined);
  return renderPage({ permissions: ['connect-share-tokens:read'] }, async () => {
    const page = await tokensOrOff(filters, after);
    return (
      <PageMain className="gap-6">
        <PageHeader
          breadcrumbs={[
            { label: 'Connect', href: CONNECT_SETTINGS_PATH },
            { label: 'Share tokens' },
          ]}
          title="Share tokens"
          description="One-time permissions to copy a verified person’s data to one recipient, each resting on a consent record."
        />
        {page === null ? (
          <Alert tone="info" title="Connect is off on this installation">
            The installation’s operator has not turned Connect on, so no share token exists here.
          </Alert>
        ) : (
          <>
            <form
              method="get"
              action={SHARE_TOKENS_PATH}
              className="flex flex-wrap items-end gap-4"
            >
              {filters.connectionId !== undefined && (
                <input type="hidden" name="connection-id" value={filters.connectionId} />
              )}
              <FormField label="Direction">
                {(control) => (
                  <select
                    {...control}
                    name="direction"
                    defaultValue={filters.direction ?? ''}
                    className={SELECT_CLASS}
                  >
                    <option value="">Both</option>
                    <option value="inbound">Inbound</option>
                    <option value="outbound">Outbound</option>
                  </select>
                )}
              </FormField>
              <FormField label="Status">
                {(control) => (
                  <select
                    {...control}
                    name="status"
                    defaultValue={filters.status ?? ''}
                    className={SELECT_CLASS}
                  >
                    <option value="">Any</option>
                    {SHARE_TOKEN_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {SHARE_TOKEN_STATUS_WORDS[status]}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <Button type="submit" variant="secondary">
                Filter
              </Button>
            </form>
            <ShareTokensTable
              caption="Share tokens"
              tokens={page.tokens}
              emptyMessage={
                filtered ? 'No share token matches these filters.' : 'No share token yet.'
              }
            />
            {page.next !== null && (
              <Link href={hrefOf(filters, page.next)} className={LINK_CLASS}>
                Next share tokens
              </Link>
            )}
          </>
        )}
      </PageMain>
    );
  });
}
