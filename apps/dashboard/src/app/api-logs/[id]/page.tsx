import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Detail } from '../../../components/detail';
import { Caller } from '../../../components/integrations/api-logs-table';
import { HttpStatusBadge } from '../../../components/integrations/badges';
import { LoggedJson } from '../../../components/integrations/json-view';
import { EmptyValue, MaskedValue } from '../../../components/masked-value';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Timestamp } from '../../../components/timestamp';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';

export const metadata: Metadata = { title: 'API log' };

export interface ApiLogPageProps {
  readonly params: Promise<{ id: string }>;
}

function Code({ value }: { readonly value: string | null }) {
  return value === null ? (
    <EmptyValue />
  ) : (
    <code className="font-mono text-xs break-all">{value}</code>
  );
}

/**
 * One server API request (C12): who made it, how it ended, and its query and bodies as JSON.
 * Secrets read `[REDACTED]`; values the API masked for a role without `pii:view` read "Hidden";
 * a body over 64 KiB shows its size and the start of it.
 */
export default async function ApiLogPage({ params }: ApiLogPageProps) {
  const { id } = await params;
  if (!idSchema('alog').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['api-logs:read'] }, async ({ api, session }) => {
    const { data: log } = await api.apiLogs.retrieve(id);
    const { attributes } = log;
    const masked = !hasPermission(session, 'pii:view');
    const bodies = [
      ['Query', attributes.query],
      ['Request body', attributes['request-body']],
      ['Response body', attributes['response-body']],
    ] as const;
    return (
      <PageMain className="gap-8">
        <PageHeader
          title={
            <code className="font-mono text-xl break-all">{`${attributes.method} ${attributes.path}`}</code>
          }
          breadcrumbs={[
            { label: 'API logs', href: '/api-logs' },
            { label: <code className="font-mono text-xs">{id}</code> },
          ]}
        />
        <section aria-labelledby="api-log-request" className="flex flex-col gap-3">
          <h2 id="api-log-request" className="text-lg font-semibold">
            Request
          </h2>
          <dl className="grid gap-4 rounded-xl border border-line bg-surface p-6 sm:grid-cols-2 lg:grid-cols-3">
            <Detail term="Status">
              <HttpStatusBadge status={attributes.status} />
            </Detail>
            <Detail term="Route">
              <Code value={attributes.route} />
            </Detail>
            <Detail term="Duration">{`${String(attributes['duration-ms'])} ms`}</Detail>
            <Detail term="Caller">
              <Caller log={log} canSeeApiKeys={hasPermission(session, 'api-keys:read')} />
            </Detail>
            <Detail term="Request ID">
              <Code value={attributes['request-id']} />
            </Detail>
            <Detail term="Idempotency key">
              <Code value={attributes['idempotency-key']} />
            </Detail>
            <Detail term="IP address">
              <MaskedValue value={attributes['ip-address']} masked={masked} />
            </Detail>
            <Detail term="User agent">
              <MaskedValue value={attributes['user-agent']} masked={masked} />
            </Detail>
            <Detail term="Time (UTC)">
              <Timestamp value={attributes['created-at']} />
            </Detail>
          </dl>
        </section>
        {bodies.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{label}</h2>
            <LoggedJson label={label} value={value} masked={masked} />
          </div>
        ))}
      </PageMain>
    );
  });
}
