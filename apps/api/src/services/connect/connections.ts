/**
 * C231 (Workflow 11A, `api-connect`): connections between two organisations of one install.
 *
 * - Create (the source, C231.1): version 1 of the share policy; `pending`; the one byte-identical 422
 *   `destination_not_found` for an unknown organisation and for one that has not opted in
 *   (`connect-inbound`, C231.10); 409 `connection_exists` for a pair that has one, whatever its
 *   status.
 * - List and retrieve (both sides, C231.2); a third organisation gets the one generic 404.
 * - Activate (the destination, in the console only, C231.3): `connect-connections:activate`, a
 *   second factor within the step-up window, the current policy version, the sealed agreement
 *   reference.
 * - Deactivate (either side, C231.4): the connection FOR UPDATE; every `created` token expires in the
 *   same transaction, with its events on both sides.
 * - Reactivate (the source, C231.5): `inactive` to `pending`.
 * - Change the policy (the source, C231.6): version n+1; an `active` connection returns to `pending`.
 *
 * Organisation-level writes (C231.9): a sandbox API key gets the one generic 404, a user without
 * `environments:production` 403. Every change stages its `connect/connection.*` event in every
 * environment of both organisations (C239.1), each with the resource as that side sees it, and its
 * audit entries on both sides (C240.4), in the transaction of the change.
 */
import {
  ATTESTED_CONSENT_DEFAULT,
  connectionStatusSchema,
  filterValues,
  idSchema,
  sharePolicySchema,
  type ConnectionResource,
  type ListConnectionsQuery,
  type SharePolicyInput,
  type ActivateConnectionBody,
} from '@openverify/contracts';
import {
  connectionExistsForPair,
  createConnection,
  createSharePolicyVersion,
  getConnectionOfOrganization,
  getSharePoliciesOfConnection,
  getUserSession,
  listConnectionsOfOrganization,
  listEnvironments,
  lockConnectionForUpdate,
  updateConnection,
  type ConnectConnectionRecord,
  type ConnectSharePolicy,
  type Db,
} from '@openverify/db';
import { STEP_UP_WINDOW_SECONDS, type AuditActor } from '@openverify/contracts';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import { InvalidTransitionError, PermissionDeniedError } from '../../errors.js';
import type { AuditLogger, Clock, IdGenerator, Principal, ServiceContext } from '../../ports.js';
import { AccessProblemError } from '../access/problems.js';
import { auditEntryOf } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import {
  crossTenant,
  type CounterpartyActor,
  type CounterpartyEvent,
  type CrossTenantCaller,
} from './cross-tenant.js';
import { connectNotFound } from './not-found.js';
import { ConnectProblemError } from './problems.js';

/** What the connection service needs (the server API's and the console's dependencies). */
export interface ConnectionDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  events: TransactionalEventPublisher;
  audit: AuditLogger;
}

/**
 * Who acts: the request's service context (its organisation and environment), the audit actor, the
 * environment's kind, and the principal when a request acts (a workflow run has none: C243.1). The
 * organisation-level writes and the peek need the principal; a run never makes them.
 */
export interface ConnectActing {
  ctx: ServiceContext;
  actor: AuditActor;
  environmentKind: 'sandbox' | 'production';
  principal?: Principal | undefined;
}

export type ConnectConnectionAction =
  'created' | 'activated' | 'deactivated' | 'reactivated' | 'share-policy-changed';

/** The caller as the cross-tenant module binds it. */
export const callerOf = (acting: ConnectActing): CrossTenantCaller => ({
  organizationId: acting.ctx.organizationId,
  environmentId: acting.ctx.environmentId,
  environmentKind: acting.environmentKind,
});

/** The kind of principal an audit actor is, as the counterparty may see it. */
export const actorKindOf = (actor: AuditActor): CounterpartyActor['kind'] =>
  actor.type === 'workflow-run' ? 'workflow' : actor.type;

/** C240.4: the counterparty sees only the organisation and the kind of principal that acted. */
export const counterpartyActorOf = (acting: ConnectActing): CounterpartyActor => ({
  'organization-id': acting.ctx.organizationId,
  kind: actorKindOf(acting.actor),
});

/** The principal of a request; a workflow run reaches none of the routes that need one. */
export function principalOf(acting: ConnectActing): Principal {
  if (acting.principal === undefined) {
    throw new PermissionDeniedError('Only an API key or a user may do this.');
  }
  return acting.principal;
}

/**
 * C231.9 (review P01): a connection write is organisation-level. A sandbox API key gets the one
 * generic 404 (the write does not exist for it, as activation by key does not); a user without
 * `environments:production` gets 403 naming it.
 */
export function assertOrganizationWrite(acting: ConnectActing): void {
  const principal = principalOf(acting);
  if (principal.kind === 'api-key') {
    if (principal.environmentKind !== 'production') {
      throw connectNotFound();
    }
    return;
  }
  if (!principal.permissions.has('environments:production')) {
    throw new PermissionDeniedError(
      'Changing a connection needs environments:production, because a connection carries both environments’ shares.',
      ['environments:production'],
    );
  }
}

/** The side of the connection the organisation is (a self-connection's is `self`). */
export function directionOf(
  connection: Pick<ConnectConnectionRecord, 'sourceOrganizationId' | 'destinationOrganizationId'>,
  organizationId: string,
): ConnectionResource['attributes']['direction'] {
  const source = connection.sourceOrganizationId === organizationId;
  const destination = connection.destinationOrganizationId === organizationId;
  return source && destination ? 'self' : source ? 'outbound' : 'inbound';
}

/** What a connection's resource is built from besides the row. */
export interface ConnectionView {
  connection: ConnectConnectionRecord;
  current: ConnectSharePolicy;
  acceptedVersion: number | null;
  names: { source: string; destination: string };
}

/** The current and the accepted versions and both names of a connection the caller is a side of. */
export async function connectionViewOf(
  db: Db,
  caller: CrossTenantCaller,
  connection: ConnectConnectionRecord,
): Promise<ConnectionView> {
  const ids = [connection.currentPolicyId, connection.acceptedPolicyId].filter(
    (id): id is string => id !== null,
  );
  const policies = await getSharePoliciesOfConnection(db, connection.id, ids);
  const current = policies.find((policy) => policy.id === connection.currentPolicyId);
  if (current === undefined) {
    throw new Error(`Connection ${connection.id} has no current policy version`);
  }
  const accepted = policies.find((policy) => policy.id === connection.acceptedPolicyId);
  return {
    connection,
    current,
    acceptedVersion: accepted?.version ?? null,
    names: await crossTenant.connectionOrganizationNames(db, caller, connection),
  };
}

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

/**
 * C230.2: the connection as `viewerOrganizationId` sees it. The source sees `creator` and no
 * agreement reference, and the destination's name only once the connection was first activated
 * (review P09); the destination sees the agreement reference and no creator (review P26); a
 * self-connection's organisation sees both. In an event payload the agreement reference is always
 * `null` (C239.2: never in an event).
 */
export function connectionResourceOf(
  view: ConnectionView,
  viewerOrganizationId: string,
  options: { forEvent?: boolean } = {},
): ConnectionResource {
  const { connection, current } = view;
  const direction = directionOf(connection, viewerOrganizationId);
  const destinationNameShown = direction !== 'outbound' || connection.activatedAt !== null;
  return {
    type: 'connect/connection',
    id: connection.id,
    attributes: {
      status: connection.status,
      direction,
      'source-organization-id': connection.sourceOrganizationId,
      'destination-organization-id': connection.destinationOrganizationId,
      'source-organization-name': view.names.source,
      'destination-organization-name': destinationNameShown ? view.names.destination : null,
      'created-at': connection.createdAt.toISOString(),
      'updated-at': connection.updatedAt.toISOString(),
      'activated-at': iso(connection.activatedAt),
      'deactivated-at': iso(connection.deactivatedAt),
      'deactivated-by': connection.deactivatedBy ?? null,
      'share-policy': {
        id: current.id,
        version: current.version,
        'created-at': current.createdAt.toISOString(),
        body: current.body as ConnectionResource['attributes']['share-policy']['body'],
      },
      'accepted-policy-version': view.acceptedVersion,
      ...(direction === 'outbound'
        ? {}
        : {
            'agreement-reference': options.forEvent === true ? null : connection.agreementReference,
          }),
    },
    relationships:
      direction === 'inbound'
        ? {}
        : {
            creator: {
              data: { type: connection.creatorType, id: connection.creatorId },
            },
          },
  };
}

/**
 * C239.1: `connect/connection.<action>` in every environment of both organisations, each with the
 * resource as that organisation sees it; the counterparty's through the cross-tenant module. C240.4:
 * the audit entry in the actor's environment, and one in each of the counterparty's environments
 * naming only `{organization-id, kind}` (none for a self-connection, which has no counterparty).
 */
async function stageConnectionChange(
  deps: ConnectionDeps,
  tx: Db,
  acting: ConnectActing,
  view: ConnectionView,
  action: ConnectConnectionAction,
): Promise<StagedEvent[]> {
  const caller = callerOf(acting);
  const { connection } = view;
  const name = `connect/connection.${action}` as const;
  const staged: StagedEvent[] = [];
  const own = await listEnvironments(tx, caller.organizationId);
  const ownPayload = {
    data: connectionResourceOf(view, caller.organizationId, { forEvent: true }),
  };
  for (const environment of own) {
    staged.push(
      await deps.events.stage(tx, { environmentId: environment.id, name, payload: ownPayload }),
    );
  }
  const auditAction = `connect-connection.${action}`;
  await deps.audit.record(
    tx,
    auditEntryOf(acting.ctx, acting.actor, {
      action: auditAction,
      resourceType: 'connect-connection',
      resourceId: connection.id,
      metadata: { 'share-policy-id': view.current.id },
    }),
  );
  if (directionOf(connection, caller.organizationId) === 'self') {
    return staged;
  }
  const counterparty =
    connection.sourceOrganizationId === caller.organizationId
      ? connection.destinationOrganizationId
      : connection.sourceOrganizationId;
  const theirs = await crossTenant.counterpartyEnvironments(tx, caller, connection);
  const theirPayload = { data: connectionResourceOf(view, counterparty, { forEvent: true }) };
  const events: CounterpartyEvent[] = theirs.map((environment) => ({
    environmentId: environment.id,
    name,
    payload: theirPayload,
  }));
  staged.push(...(await crossTenant.stageCounterpartyEvents(tx, events, deps.events)));
  await crossTenant.appendCounterpartyAudit(
    tx,
    theirs.map((environment) => ({
      environmentId: environment.id,
      action: auditAction,
      actor: counterpartyActorOf(acting),
      resourceType: 'connect-connection',
      resourceId: connection.id,
      details: { 'share-policy-id': view.current.id },
    })),
  );
  return staged;
}

/** The connection document for the caller. */
async function documentOf(
  db: Db,
  acting: ConnectActing,
  connection: ConnectConnectionRecord,
): Promise<{ data: ConnectionResource }> {
  const caller = callerOf(acting);
  const view = await connectionViewOf(db, caller, connection);
  return { data: connectionResourceOf(view, caller.organizationId) };
}

/** Parses a policy body with its default (`attested-consent: non-biometric`). */
function storedPolicyOf(policy: SharePolicyInput): Record<string, unknown> {
  return sharePolicySchema.parse({
    ...policy,
    'attested-consent': policy['attested-consent'] ?? ATTESTED_CONSENT_DEFAULT,
  });
}

/** The organisation-scoped connection, or the one 404. */
async function findConnection(
  db: Db,
  organizationId: string,
  id: string,
): Promise<ConnectConnectionRecord> {
  const connection = await getConnectionOfOrganization(db, organizationId, id);
  if (connection === null || connection.status === 'archived') {
    throw connectNotFound();
  }
  return connection;
}

/** A unique violation of the ordered pair's index (a concurrent create of the same pair). */
const pairTaken = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  JSON.stringify(Object.values(error)).includes('connect_connections_source_destination_key');

/**
 * C231.1: the source creates a `pending` connection with policy version 1.
 * @throws {ConnectProblemError} 422 `destination_not_found` (unknown or not opted in, one body),
 *   409 `connection_exists`.
 */
export async function createConnectionFor(
  deps: ConnectionDeps,
  acting: ConnectActing,
  attributes: { 'destination-organization-id': string; 'share-policy': SharePolicyInput },
): Promise<{ data: ConnectionResource }> {
  assertOrganizationWrite(acting);
  const destination = attributes['destination-organization-id'];
  const source = acting.ctx.organizationId;
  const caller = callerOf(acting);
  const now = deps.clock.now();
  const policy = storedPolicyOf(attributes['share-policy']);
  const notFound = () =>
    new ConnectProblemError(
      'destination_not_found',
      'No organisation with that id accepts connections on this installation.',
      {
        errors: [
          {
            location: 'body',
            pointer: '/data/attributes/destination-organization-id',
            detail: 'no organisation with this id accepts connections',
          },
        ],
      },
    );
  if (!(await crossTenant.acceptsInboundConnections(deps.db, destination))) {
    throw notFound();
  }
  const exists = () =>
    new ConnectProblemError(
      'connection_exists',
      'A connection to that organisation already exists. Reactivate it or change its policy.',
    );
  if (await connectionExistsForPair(deps.db, source, destination)) {
    throw exists();
  }
  const creator = acting.actor.type === 'user' ? 'user' : 'api-key';
  let result: { document: { data: ConnectionResource }; staged: StagedEvent[] };
  try {
    result = await deps.db.transaction(async (tx) => {
      const { connection } = await createConnection(tx, {
        id: deps.ids.newId('cxn'),
        sourceOrganizationId: source,
        destinationOrganizationId: destination,
        creatorType: creator,
        creatorId: acting.actor.id,
        policyId: deps.ids.newId('cxnp'),
        policy,
        createdAt: now,
      });
      const view = await connectionViewOf(tx, caller, connection);
      const staged = await stageConnectionChange(deps, tx, acting, view, 'created');
      return { document: { data: connectionResourceOf(view, source) }, staged };
    });
  } catch (error) {
    if (pairTaken(error)) {
      throw exists();
    }
    throw error;
  }
  await deps.events.dispatch(result.staged);
  return result.document;
}

/** C231.2: both directions, newest first, with the vendor's filters. */
export async function listConnections(
  deps: Pick<ConnectionDeps, 'db'>,
  acting: ConnectActing,
  query: ListConnectionsQuery,
): Promise<{ data: ConnectionResource[]; links: { next: string | null } }> {
  const organizationId = acting.ctx.organizationId;
  const page = await withCursor(() =>
    listConnectionsOfOrganization(
      deps.db,
      organizationId,
      {
        statuses: filterValues(query['filter[status]'], connectionStatusSchema),
        destinationOrganizationIds: filterValues(
          query['filter[destination-organization-id]'],
          idSchema('org'),
        ),
      },
      pageRequest(query),
    ),
  );
  const caller = callerOf(acting);
  const data: ConnectionResource[] = [];
  for (const connection of page.items) {
    data.push(
      connectionResourceOf(await connectionViewOf(deps.db, caller, connection), organizationId),
    );
  }
  const filters = {
    'filter[status]': query['filter[status]'],
    'filter[destination-organization-id]': query['filter[destination-organization-id]'],
  };
  return {
    data,
    links: { next: nextLink('/api/v1/connect/connections', filters, query, page.next) },
  };
}

/** C231.2: one connection as the caller's side sees it, or the one 404. */
export async function getConnectionDocument(
  deps: Pick<ConnectionDeps, 'db'>,
  acting: ConnectActing,
  id: string,
): Promise<{ data: ConnectionResource }> {
  return documentOf(deps.db, acting, await findConnection(deps.db, acting.ctx.organizationId, id));
}

/** Runs a change under the connection's row lock and stages its event and audit entries. */
async function changeConnection(
  deps: ConnectionDeps,
  acting: ConnectActing,
  id: string,
  action: ConnectConnectionAction,
  change: (
    tx: Db,
    connection: ConnectConnectionRecord,
    now: Date,
  ) => Promise<{ connection: ConnectConnectionRecord; staged?: StagedEvent[] }>,
): Promise<{ data: ConnectionResource }> {
  const organizationId = acting.ctx.organizationId;
  const caller = callerOf(acting);
  const now = deps.clock.now();
  const { document, staged } = await deps.db.transaction(async (tx) => {
    const locked = await lockConnectionForUpdate(tx, organizationId, id);
    if (locked === null || locked.status === 'archived') {
      throw connectNotFound();
    }
    const changed = await change(tx, locked, now);
    const view = await connectionViewOf(tx, caller, changed.connection);
    const events = await stageConnectionChange(deps, tx, acting, view, action);
    return {
      document: { data: connectionResourceOf(view, organizationId) },
      staged: [...(changed.staged ?? []), ...events],
    };
  });
  await deps.events.dispatch(staged);
  return document;
}

/** The hook a deactivation calls to expire the connection's tokens with their events (C231.4). */
export type ExpireTokensOnDeactivation = (
  tx: Db,
  acting: ConnectActing,
  connection: ConnectConnectionRecord,
  now: Date,
) => Promise<StagedEvent[]>;

/**
 * C231.4: either side; `pending` or `active` to `inactive`, every `created` token expiring in the
 * same transaction (`expireTokens`, the share-token service's, stages their events).
 * @throws {ConnectProblemError} 409 `connection_not_active` when already inactive.
 */
export async function deactivateConnection(
  deps: ConnectionDeps,
  acting: ConnectActing,
  id: string,
  expireTokens: ExpireTokensOnDeactivation,
): Promise<{ data: ConnectionResource }> {
  assertOrganizationWrite(acting);
  const organizationId = acting.ctx.organizationId;
  return changeConnection(deps, acting, id, 'deactivated', async (tx, connection, now) => {
    if (connection.status === 'inactive') {
      throw new ConnectProblemError('connection_not_active', 'The connection is already inactive.');
    }
    const updated = await updateConnection(tx, connection.id, {
      status: 'inactive',
      deactivatedAt: now,
      deactivatedBy: connection.sourceOrganizationId === organizationId ? 'source' : 'destination',
      updatedAt: now,
    });
    const staged = await expireTokens(tx, acting, updated, now);
    return { connection: updated, staged };
  });
}

/** The connection the caller is the source of, or the one 404 (a source-only action). */
function assertSource(connection: ConnectConnectionRecord, organizationId: string): void {
  if (connection.sourceOrganizationId !== organizationId) {
    throw connectNotFound();
  }
}

/**
 * C231.5: the source only; `inactive` to `pending`, and the destination must activate again.
 * @throws {InvalidTransitionError} 409 when the connection is not inactive.
 */
export async function reactivateConnection(
  deps: ConnectionDeps,
  acting: ConnectActing,
  id: string,
): Promise<{ data: ConnectionResource }> {
  assertOrganizationWrite(acting);
  const organizationId = acting.ctx.organizationId;
  return changeConnection(deps, acting, id, 'reactivated', async (tx, connection, now) => {
    assertSource(connection, organizationId);
    if (connection.status !== 'inactive') {
      throw new InvalidTransitionError(
        `Only an inactive connection can be reactivated; this one is ${connection.status}.`,
      );
    }
    return {
      connection: await updateConnection(tx, connection.id, {
        status: 'pending',
        deactivatedAt: null,
        deactivatedBy: null,
        updatedAt: now,
      }),
    };
  });
}

/**
 * C231.6: the source writes version n+1; an `active` connection returns to `pending` until the
 * destination accepts it; a `created` token keeps the version it was created under.
 */
export async function changeSharePolicy(
  deps: ConnectionDeps,
  acting: ConnectActing,
  id: string,
  policy: SharePolicyInput,
): Promise<{ data: ConnectionResource }> {
  assertOrganizationWrite(acting);
  const organizationId = acting.ctx.organizationId;
  const body = storedPolicyOf(policy);
  return changeConnection(deps, acting, id, 'share-policy-changed', async (tx, connection, now) => {
    assertSource(connection, organizationId);
    const [current] = await getSharePoliciesOfConnection(tx, connection.id, [
      connection.currentPolicyId ?? '',
    ]);
    const next = await createSharePolicyVersion(tx, {
      id: deps.ids.newId('cxnp'),
      connectionId: connection.id,
      version: (current?.version ?? 0) + 1,
      body,
      createdAt: now,
      createdByType: acting.actor.type === 'user' ? 'user' : 'api-key',
      createdById: acting.actor.id,
    });
    return {
      connection: await updateConnection(tx, connection.id, {
        currentPolicyId: next.id,
        ...(connection.status === 'active' ? { status: 'pending' as const } : {}),
        updatedAt: now,
      }),
    };
  });
}

/**
 * C231.3: the destination's user activates in the console. The route takes a user session only;
 * this checks `connect-connections:activate` (organisation-level, so only an organisation-wide
 * assignment grants it), the step-up (a second factor verified within the last
 * `STEP_UP_WINDOW_SECONDS`; a session that never verified one cannot activate, whatever the
 * organisation's `require-mfa`), that the caller is the destination (else the one 404), that the
 * connection is `pending` (409 `invalid-transition`), and that the body accepts the current version
 * (409 `share_policy_changed`). It seals the agreement reference and records the accepted version.
 */
export async function activateConnection(
  deps: ConnectionDeps,
  acting: ConnectActing & { principal: Extract<Principal, { kind: 'user' }> },
  id: string,
  attributes: ActivateConnectionBody['data']['attributes'],
): Promise<{ data: ConnectionResource }> {
  const { principal } = acting;
  if (!principal.permissions.has('connect-connections:activate')) {
    throw new PermissionDeniedError('Activating a connection needs connect-connections:activate.', [
      'connect-connections:activate',
    ]);
  }
  const organizationId = principal.organizationId;
  const existing = await findConnection(deps.db, organizationId, id);
  if (existing.destinationOrganizationId !== organizationId) {
    throw connectNotFound();
  }
  await assertActivationSteppedUp(deps.db, principal.userSessionId, deps.clock.now());
  return changeConnection(deps, acting, id, 'activated', async (tx, connection, now) => {
    if (connection.status !== 'pending') {
      throw new InvalidTransitionError(
        `Only a pending connection can be activated; this one is ${connection.status}.`,
      );
    }
    const [current] = await getSharePoliciesOfConnection(tx, connection.id, [
      connection.currentPolicyId ?? '',
    ]);
    if (current?.version !== attributes['policy-version']) {
      throw new ConnectProblemError(
        'share_policy_changed',
        'The share policy changed since it was shown. Review the current version and accept it.',
        {
          errors: [
            {
              location: 'body',
              pointer: '/data/attributes/policy-version',
              detail: `the current version is ${String(current?.version ?? 0)}`,
            },
          ],
        },
      );
    }
    return {
      connection: await updateConnection(tx, connection.id, {
        status: 'active',
        acceptedPolicyId: current.id,
        agreementReference: attributes['agreement-reference'],
        activatedAt: now,
        activatedByUserId: principal.userId,
        updatedAt: now,
      }),
    };
  });
}

/**
 * C231.3 (C168.1's step-up, decision 18): the session verified a second factor within
 * `STEP_UP_WINDOW_SECONDS` before `now`.
 * @throws {AccessProblemError} 403 `step_up_required`.
 */
async function assertActivationSteppedUp(db: Db, sessionId: string, now: Date): Promise<void> {
  const session = await getUserSession(db, sessionId);
  const verifiedAt = session?.mfaVerifiedAt ?? null;
  const age = verifiedAt === null ? Infinity : now.getTime() - verifiedAt.getTime();
  if (!(age >= 0 && age <= STEP_UP_WINDOW_SECONDS * 1000)) {
    throw new AccessProblemError(
      'step_up_required',
      'Verify your second factor again before activating a connection.',
    );
  }
}
