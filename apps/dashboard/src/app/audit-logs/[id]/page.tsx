import { idSchema, type UserAuditLogResource } from '@openverify/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Detail } from '../../../components/detail';
import { LINK_CLASS } from '../../../components/link-styles';
import { EmptyValue, MaskedValue } from '../../../components/masked-value';
import {
  AuditActorValue,
  actorEntriesHref,
  type OperatorDirectory,
} from '../../../components/operators/audit-actor';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Timestamp } from '../../../components/timestamp';
import { getAuditLog } from '../../../lib/api/audit-logs';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { userDirectory } from '../../../lib/api/users';
import { listHref } from '../../../lib/list-query';

export const metadata: Metadata = { title: 'Audit log entry' };

/** The console page of each resource type that has one, by `resource-type`. */
const RESOURCE_PAGES: Readonly<Record<string, string>> = {
  inquiry: '/inquiries',
  account: '/accounts',
  'inquiry-template': '/templates',
  webhook: '/webhooks',
  'api-key': '/api-keys',
  event: '/events',
  role: '/roles',
  // C141 (Workflow 8C): a workflow and a run each have a page.
  workflow: '/workflows',
  'workflow-run': '/workflows/runs',
};

export interface AuditLogPageProps {
  readonly params: Promise<{ id: string }>;
}

function ResourceId({ type, id }: { readonly type: string | null; readonly id: string | null }) {
  if (id === null) {
    return <EmptyValue />;
  }
  const page = type === null ? undefined : RESOURCE_PAGES[type];
  const code = <code className="font-mono text-xs">{id}</code>;
  return page === undefined ? (
    code
  ) : (
    <Link href={`${page}/${encodeURIComponent(id)}`} className={LINK_CLASS}>
      {code}
    </Link>
  );
}

function EntryView({
  entry,
  directory,
  masked,
}: {
  readonly entry: UserAuditLogResource;
  readonly directory: OperatorDirectory | null;
  readonly masked: boolean;
}) {
  const { attributes } = entry;
  const { actor } = attributes;
  // K7A-8: the system's entries have no actor id to link.
  const byActor = actorEntriesHref(actor);
  const metadata = Object.keys(attributes.metadata).length === 0 ? null : attributes.metadata;
  return (
    <PageMain className="gap-8">
      <PageHeader
        title={<code className="font-mono">{attributes.action}</code>}
        breadcrumbs={[{ label: 'Audit logs', href: '/audit-logs' }, { label: entry.id }]}
      />
      <section aria-labelledby="entry-details" className="flex flex-col gap-4">
        <h2 id="entry-details" className="text-lg font-semibold">
          Details
        </h2>
        <dl className="grid gap-4 rounded-xl border border-line bg-surface p-6 sm:grid-cols-2">
          <Detail term="When (UTC)">
            <Timestamp value={attributes['created-at']} />
          </Detail>
          <Detail term="Action">
            <code className="font-mono text-xs">{attributes.action}</code>
          </Detail>
          <Detail term="Actor">
            <AuditActorValue actor={actor} directory={directory} />
          </Detail>
          <Detail term="Resource type">{attributes['resource-type'] ?? <EmptyValue />}</Detail>
          <Detail term="Resource ID">
            <ResourceId type={attributes['resource-type']} id={attributes['resource-id']} />
          </Detail>
          <Detail term="IP address">
            <MaskedValue value={attributes['ip-address']} masked={masked} />
          </Detail>
          <Detail term="User agent">
            <MaskedValue value={attributes['user-agent']} masked={masked} />
          </Detail>
        </dl>
      </section>
      <section aria-labelledby="entry-metadata" className="flex flex-col gap-4">
        <h2 id="entry-metadata" className="text-lg font-semibold">
          Metadata
        </h2>
        {metadata === null ? (
          <p className="text-sm text-ink-muted">No metadata.</p>
        ) : (
          <pre className="overflow-x-auto rounded-xl border border-line bg-canvas p-4 font-mono text-xs">
            {JSON.stringify(metadata, null, 2)}
          </pre>
        )}
      </section>
      <nav aria-label="Related entries" className="flex flex-wrap gap-6 text-sm">
        {byActor !== null && (
          <Link href={byActor} className={LINK_CLASS}>
            Entries by this actor
          </Link>
        )}
        {attributes['resource-id'] !== null && (
          <Link
            href={listHref('/audit-logs', { 'resource-id': attributes['resource-id'] })}
            className={LINK_CLASS}
          >
            Entries about this resource
          </Link>
        )}
      </nav>
    </PageMain>
  );
}

/** One audit log entry (C15): every member, the actor named, and related entries. */
export default async function AuditLogPage({ params }: AuditLogPageProps) {
  const { id } = await params;
  if (!idSchema('aud').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['audit-logs:read'] }, async ({ session }) => {
    const entry = await getAuditLog(id);
    const directory =
      entry.attributes.actor.type === 'user' && hasPermission(session, 'users:read')
        ? await userDirectory()
        : null;
    return (
      <EntryView entry={entry} directory={directory} masked={!hasPermission(session, 'pii:view')} />
    );
  });
}
