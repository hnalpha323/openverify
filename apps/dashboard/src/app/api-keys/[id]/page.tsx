import { idSchema } from '@openverify/contracts';
import { Alert } from '@openverify/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Detail } from '../../../components/detail';
import { ApiKeyActions } from '../../../components/integrations/api-key-actions';
import {
  ApiKeyStatus,
  PiiMasked,
  TokenPrefix,
} from '../../../components/integrations/api-keys-table';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Timestamp } from '../../../components/timestamp';
import { apiKeyState } from '../../../lib/api/api-keys';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { SETTINGS_COPY } from '../../../lib/copy/settings';
import { cloneApiKey, expireApiKey, rotateApiKey, updateApiKey } from '../actions';

export const metadata: Metadata = { title: 'API key' };

const KEYS = SETTINGS_COPY.keys;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ApiKeyPageProps {
  readonly params: Promise<{ id: string }>;
}

function Codes({ values }: { readonly values: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {values.map((value) => (
        <li key={value}>
          <code className="font-mono text-xs">{value}</code>
        </li>
      ))}
    </ul>
  );
}

/** One API key (C12): what it may do and where from, its state, and the changes allowed. */
export default async function ApiKeyPage({ params }: ApiKeyPageProps) {
  const { id } = await params;
  if (!idSchema('key').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['api-keys:read'] }, async ({ api, session }) => {
    const { data: key } = await api.apiKeys.retrieve(id);
    const { attributes } = key;
    const state = apiKeyState(attributes['expires-at'], new Date());
    const used = attributes['last-used-at'];
    // C169.2: whole days since creation; the API says whether that passes the environment's warning.
    const age = Math.floor((Date.now() - Date.parse(attributes['created-at'])) / DAY_MS);
    return (
      <PageMain className="gap-8">
        <PageHeader
          title={attributes.name}
          breadcrumbs={[{ label: 'API keys', href: '/api-keys' }, { label: attributes.name }]}
        />
        {attributes['age-warning'] === true && <Alert tone="warning">{KEYS.ageWarning(age)}</Alert>}
        {hasPermission(session, 'api-keys:write') && (
          <ApiKeyActions
            apiKeyId={id}
            name={attributes.name}
            allowedIps={attributes['allowed-ips']}
            expired={state === 'expired'}
            piiMasked={!hasPermission(session, 'pii:view')}
            // A copy of a masked key is masked too (Workflow 2B F001, C25.6).
            maskedKey={attributes['pii-masked'] === true}
            update={updateApiKey}
            expire={expireApiKey}
            clone={cloneApiKey}
            rotate={rotateApiKey}
            note={attributes.note ?? null}
            attributeBlocklist={attributes['attribute-blocklist'] ?? []}
          />
        )}
        <section aria-labelledby="api-key-details" className="flex flex-col gap-3">
          <h2 id="api-key-details" className="text-lg font-semibold">
            Details
          </h2>
          <dl className="grid gap-4 rounded-xl border border-line bg-surface p-6 sm:grid-cols-2 lg:grid-cols-3">
            <Detail term="Status (UTC)">
              <ApiKeyStatus row={{ key, state }} />
            </Detail>
            <Detail term="Token">
              <TokenPrefix prefix={attributes['token-prefix']} />
            </Detail>
            <Detail term="Scopes">
              <Codes values={attributes.scopes} />
            </Detail>
            <Detail term="Allowed IP ranges">
              {attributes['allowed-ips'].length === 0 ? (
                'Every address'
              ) : (
                <Codes values={attributes['allowed-ips']} />
              )}
            </Detail>
            <Detail term="API version">{attributes['api-version']}</Detail>
            <Detail term="Personal data">
              <PiiMasked masked={attributes['pii-masked']} explain />
            </Detail>
            <Detail term="Last used (UTC)">
              {used === null ? 'Never' : <Timestamp value={used} />}
            </Detail>
            <Detail term="Created (UTC)">
              <Timestamp value={attributes['created-at']} />
            </Detail>
            <Detail term={KEYS.ageTerm}>{KEYS.ageDays(age)}</Detail>
            <Detail term={KEYS.note}>{attributes.note ?? KEYS.noNote}</Detail>
            <Detail term={KEYS.blocklist}>
              {(attributes['attribute-blocklist'] ?? []).length === 0 ? (
                KEYS.noBlocklist
              ) : (
                <Codes values={attributes['attribute-blocklist'] ?? []} />
              )}
            </Detail>
            <Detail term="Key ID">
              <code className="font-mono text-xs">{key.id}</code>
            </Detail>
          </dl>
        </section>
      </PageMain>
    );
  });
}
