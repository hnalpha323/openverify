import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '../../components/empty-state';
import { ApiKeysTable } from '../../components/integrations/api-keys-table';
import { PRIMARY_LINK_BUTTON } from '../../components/integrations/link-button';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { RateLimitPanel } from '../../components/integrations/rate-limit-panel';
import { apiKeyState, listApiKeys, readRateLimits } from '../../lib/api/api-keys';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';

export const metadata: Metadata = { title: 'API keys' };

export interface ApiKeysPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The environment's API keys (C12), whether each sees personal data masked (C25.6), a way to
 * create one for `api-keys:write`, and the caller's rate limit (C26).
 */
export default async function ApiKeysPage({ searchParams }: ApiKeysPageProps) {
  const after = parseCursor((await searchParams).after, 'key');
  return renderPage({ permissions: ['api-keys:read'] }, async ({ api, session }) => {
    const page = await listApiKeys(api, after);
    // After the list, not beside it: the panel is information, and the list is the page.
    const rateLimits = await readRateLimits(api);
    const now = new Date();
    const canWrite = hasPermission(session, 'api-keys:write');
    const create = (
      <Link href="/api-keys/new" className={PRIMARY_LINK_BUTTON}>
        Create API key
      </Link>
    );
    return (
      <PageMain>
        <PageHeader
          title="API keys"
          description="Keys your servers call the OpenVerify API with in this environment. A key's token is shown once, when it is made."
          {...(canWrite ? { actions: create } : {})}
        />
        {page.data.length === 0 && after === undefined ? (
          <EmptyState title="No API keys yet">
            Your servers need a key to create inquiries and read their results.
          </EmptyState>
        ) : (
          <ApiKeysTable
            rows={page.data.map((key) => ({
              key,
              state: apiKeyState(key.attributes['expires-at'], now),
            }))}
          />
        )}
        <Pagination
          path="/api-keys"
          query={{}}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'key')}
        />
        <RateLimitPanel limits={rateLimits} />
      </PageMain>
    );
  });
}
