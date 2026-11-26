import type { ConnectionResource } from '@openverify/contracts';
import { PageSection } from '../lifecycle/page-section';
import { Detail } from '../detail';
import { EmptyValue } from '../masked-value';
import { PageHeader } from '../page-header';
import { PageMain } from '../page-main';
import { Badge } from '../status-badge';
import { Timestamp } from '../timestamp';
import { ConnectionActionButtons, type ConnectionActionHandlers } from './connection-actions';
import { DESTINATION_NAME_PENDING, counterpartyOf } from './connection-summary';
import { SampleLabel } from './sample-label';
import {
  CONNECTION_DIRECTION_WORDS,
  CONNECTION_STATUS_TONES,
  CONNECTION_STATUS_WORDS,
} from './connect-words';
import { sharePolicyStatements } from './share-policy-words';
import { SharePolicyView } from './share-policy-view';

export interface ConnectionAbilities {
  /** `connect-connections:activate`. */
  readonly activate: boolean;
  /** `connect-connections:write`. */
  readonly write: boolean;
}

export interface ConnectionViewProps {
  readonly connection: ConnectionResource;
  readonly abilities: ConnectionAbilities;
  readonly actions: ConnectionActionHandlers;
}

const version = (value: number) => `Version ${String(value)}`;

/** C231.6: a changed policy waits for the destination; whose words depend on the side. */
function pendingChange(connection: ConnectionResource): string | null {
  const { attributes } = connection;
  const current = attributes['share-policy'].version;
  const accepted = attributes['accepted-policy-version'];
  if (attributes.status !== 'pending' || accepted === null || accepted === current) {
    return null;
  }
  return attributes.direction === 'outbound'
    ? `You changed the policy: version ${String(current)} waits for the destination’s acceptance. It accepted version ${String(accepted)}.`
    : `The source changed the policy: version ${String(current)} waits for your acceptance. You accepted version ${String(accepted)}.`;
}

/**
 * C242.1: one connection as the caller's side sees it: the two organisations, the status and the
 * versions, the agreement reference on the destination side (not personal data, so no `pii:view`;
 * the source is never served it), the policy in words, and the actions this side may take.
 */
export function ConnectionView({ connection, abilities, actions }: ConnectionViewProps) {
  const { attributes } = connection;
  const policy = attributes['share-policy'];
  const statements = sharePolicyStatements(policy.body);
  const { name, sample } = counterpartyOf(connection);
  const change = pendingChange(connection);
  const deactivatedAt = attributes['deactivated-at'];
  const deactivatedBy = attributes['deactivated-by'];
  const accepted = attributes['accepted-policy-version'];
  const hasReference = Object.hasOwn(attributes, 'agreement-reference');
  const reference = attributes['agreement-reference'] ?? null;

  return (
    <PageMain className="gap-8">
      <PageHeader
        breadcrumbs={[{ label: 'Connect', href: '/settings/connect' }, { label: name }]}
        title={name}
        description={
          <>
            <Badge
              status={attributes.status}
              label={CONNECTION_STATUS_WORDS[attributes.status]}
              tone={CONNECTION_STATUS_TONES[attributes.status]}
            />
            {sample && <SampleLabel />}
          </>
        }
        actions={
          <ConnectionActionButtons
            connectionId={connection.id}
            status={attributes.status}
            direction={attributes.direction}
            counterpartyName={name}
            policyVersion={policy.version}
            statements={statements}
            policyJson={JSON.stringify(policy.body, null, 2)}
            canActivate={abilities.activate}
            canWrite={abilities.write}
            actions={actions}
          />
        }
      />

      {change !== null && (
        <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 text-sm">
          <p>{change}</p>
          <p className="text-ink-muted">
            The API serves only the current version’s text, so the earlier version’s wording is not
            shown here.
          </p>
        </div>
      )}

      <PageSection
        id="connection-details"
        title="Details"
        description="Activation records that a named user of the destination accepted a stated policy and cited an agreement. It is not a person’s consent: every share rests on its own consent record."
      >
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Detail term="Direction">{CONNECTION_DIRECTION_WORDS[attributes.direction]}</Detail>
          <Detail term="Source">{attributes['source-organization-name']}</Detail>
          <Detail term="Destination">
            {attributes['destination-organization-name'] ?? DESTINATION_NAME_PENDING}
          </Detail>
          <Detail term="Status">{CONNECTION_STATUS_WORDS[attributes.status]}</Detail>
          <Detail term="Policy version">{version(policy.version)}</Detail>
          <Detail term="Accepted version">
            {accepted === null ? 'Not accepted yet' : version(accepted)}
          </Detail>
          {hasReference && (
            <Detail term="Agreement reference">{reference ?? <EmptyValue />}</Detail>
          )}
          <Detail term="Created (UTC)">
            <Timestamp value={attributes['created-at']} />
          </Detail>
          <Detail term="Activated (UTC)">
            {attributes['activated-at'] === null ? (
              <EmptyValue />
            ) : (
              <Timestamp value={attributes['activated-at']} />
            )}
          </Detail>
          <Detail term="Deactivated">
            {deactivatedAt === null ? (
              <EmptyValue />
            ) : (
              <>
                <Timestamp value={deactivatedAt} /> UTC
                {deactivatedBy === null ? '' : ` by the ${deactivatedBy}`}
              </>
            )}
          </Detail>
        </dl>
      </PageSection>

      <PageSection
        id="connection-policy"
        title={`Share policy, ${version(policy.version).toLowerCase()}`}
        description="What the platform will copy under this connection. It says nothing about what the destination does with a copy."
      >
        <SharePolicyView statements={statements} />
      </PageSection>
    </PageMain>
  );
}
