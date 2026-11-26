/**
 * C240.2 (Workflow 11A, `api-connect` checkpoint 4): the Connect authorization matrix, as data. Every
 * route `api-connect` owns against each caller (the source organisation's environment of the
 * token's kind and of the other kind, the destination's of each kind, a third organisation, a
 * self-connection's one organisation) and each principal (an API key with and without the scope, a
 * sandbox and a production key, a user with and without `pii:view`, with an organisation-wide and an
 * environment-scoped assignment, with and without `environments:production`), with the expected
 * status. Every refusal of an unseen object is the one 404 of C232.8.
 *
 * Two drivers run the table: the routes on PGlite (`authorization-matrix.test.ts`, the contract test)
 * and the services on Postgres 17 (`connect-locks.integration.test.ts`, the Testcontainers suite).
 * A case marked `routeOnly` is decided by the route's static scope, which only the routes hold.
 * The console's activation (a user session only; an API key never reaches a dashboard route) is
 * held by `routes/dashboard/connect-activate.test.ts`.
 */
import { newId, type SharePolicyInput } from '@openverify/contracts';
import { ORGANIZATION_LEVEL_PERMISSIONS, PERMISSIONS, type Permission } from '@openverify/core';
import {
  consentRecords,
  createInquiry,
  createInquiryTemplate,
  createVerification,
  setVerificationStatus,
  updateConnection,
  type Db,
} from '@openverify/db';
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import type { Principal } from '../../ports.js';
import { createConnectionFor, type ConnectActing } from './connections.js';
import { createShareTokenFor, type ShareTokenDeps } from './share-tokens.js';

export type MatrixRoute =
  | 'connection.list'
  | 'connection.get'
  | 'connection.deactivate'
  | 'connection.reactivate'
  | 'connection.policy'
  | 'token.list'
  | 'token.create'
  | 'token.get'
  | 'token.peek'
  | 'token.expire';

export type MatrixOrganisation = 'source' | 'destination' | 'third' | 'self';
export type MatrixKind = 'sandbox' | 'production';
export type MatrixPrincipal =
  | 'key'
  | 'key:no-scope'
  | 'key:read-only'
  | 'user'
  | 'user:no-pii'
  | 'user:no-production'
  | 'user:environment-scoped';

export interface MatrixCase {
  route: MatrixRoute;
  organisation: MatrixOrganisation;
  kind: MatrixKind;
  principal: MatrixPrincipal;
  /** The token the case targets: the sandbox one, else the production one (users act there). */
  token?: MatrixKind;
  expected: number;
  /** Decided by the route's static scope (C240.1): the services' driver skips it. */
  routeOnly?: true;
}

const at = (
  route: MatrixRoute,
  organisation: MatrixOrganisation,
  kind: MatrixKind,
  principal: MatrixPrincipal,
  expected: number,
  extra: Partial<MatrixCase> = {},
): MatrixCase => ({ route, organisation, kind, principal, expected, ...extra });

/** The matrix (C240.2). */
export const AUTHORIZATION_MATRIX: readonly MatrixCase[] = [
  // Connections: both directions read, organisation-level writes (C231.2, C231.9).
  at('connection.list', 'source', 'sandbox', 'key', 200),
  at('connection.list', 'third', 'production', 'key', 200),
  at('connection.get', 'source', 'sandbox', 'key', 200),
  at('connection.get', 'source', 'production', 'key', 200),
  at('connection.get', 'destination', 'sandbox', 'key', 200),
  at('connection.get', 'destination', 'production', 'key', 200),
  at('connection.get', 'third', 'sandbox', 'key', 404),
  at('connection.get', 'third', 'production', 'user', 404),
  at('connection.get', 'source', 'production', 'user', 200),
  at('connection.get', 'source', 'production', 'key:no-scope', 403, { routeOnly: true }),
  at('connection.get', 'self', 'sandbox', 'key', 200),
  at('connection.deactivate', 'source', 'sandbox', 'key', 404),
  at('connection.deactivate', 'source', 'production', 'key', 200),
  at('connection.deactivate', 'destination', 'sandbox', 'key', 404),
  at('connection.deactivate', 'destination', 'production', 'key', 200),
  at('connection.deactivate', 'third', 'production', 'key', 404),
  at('connection.deactivate', 'source', 'production', 'user', 200),
  at('connection.deactivate', 'source', 'production', 'user:no-production', 403),
  at('connection.deactivate', 'source', 'production', 'user:environment-scoped', 403, {
    routeOnly: true,
  }),
  at('connection.deactivate', 'source', 'production', 'key:read-only', 403, { routeOnly: true }),
  at('connection.reactivate', 'source', 'production', 'key', 409),
  at('connection.reactivate', 'source', 'sandbox', 'key', 404),
  at('connection.reactivate', 'destination', 'production', 'key', 404),
  at('connection.reactivate', 'third', 'production', 'key', 404),
  at('connection.policy', 'source', 'production', 'key', 200),
  at('connection.policy', 'source', 'sandbox', 'key', 404),
  at('connection.policy', 'destination', 'production', 'key', 404),
  at('connection.policy', 'third', 'production', 'key', 404),
  at('connection.policy', 'source', 'production', 'user:no-production', 403),
  // Share tokens: bound to the connection, the side and the environment kind (C232.8).
  at('token.list', 'destination', 'sandbox', 'key', 200),
  at('token.list', 'third', 'sandbox', 'key', 200),
  at('token.create', 'source', 'sandbox', 'key', 201),
  at('token.create', 'source', 'production', 'key', 404),
  at('token.create', 'destination', 'sandbox', 'key', 404),
  at('token.create', 'third', 'sandbox', 'key', 404),
  at('token.create', 'source', 'sandbox', 'key:read-only', 403, { routeOnly: true }),
  at('token.get', 'source', 'sandbox', 'key', 200),
  at('token.get', 'source', 'production', 'key', 404),
  at('token.get', 'destination', 'sandbox', 'key', 200),
  at('token.get', 'destination', 'production', 'key', 404),
  at('token.get', 'third', 'sandbox', 'key', 404),
  at('token.get', 'third', 'production', 'key', 404),
  at('token.get', 'source', 'sandbox', 'key:no-scope', 403, { routeOnly: true }),
  at('token.get', 'source', 'production', 'user', 200, { token: 'production' }),
  at('token.get', 'destination', 'production', 'user', 200, { token: 'production' }),
  at('token.get', 'destination', 'production', 'user:no-pii', 200, { token: 'production' }),
  at('token.get', 'self', 'sandbox', 'key', 200),
  at('token.peek', 'destination', 'sandbox', 'key', 200),
  at('token.peek', 'destination', 'sandbox', 'key:read-only', 403),
  at('token.peek', 'source', 'sandbox', 'key', 404),
  at('token.peek', 'destination', 'production', 'key', 404),
  at('token.peek', 'third', 'sandbox', 'key', 404),
  at('token.peek', 'destination', 'production', 'user', 200, { token: 'production' }),
  at('token.peek', 'destination', 'production', 'user:no-pii', 403, { token: 'production' }),
  at('token.peek', 'source', 'production', 'user', 404, { token: 'production' }),
  at('token.peek', 'self', 'sandbox', 'key', 200),
  at('token.expire', 'source', 'sandbox', 'key', 200),
  at('token.expire', 'source', 'production', 'key', 404),
  at('token.expire', 'destination', 'sandbox', 'key', 404),
  at('token.expire', 'third', 'sandbox', 'key', 404),
  at('token.expire', 'source', 'production', 'user', 200, { token: 'production' }),
  at('token.expire', 'destination', 'production', 'user', 404, { token: 'production' }),
  at('token.expire', 'self', 'sandbox', 'key', 200),
];

/** The permissions a principal of the matrix holds (an API key's scopes, a user's permissions). */
export function permissionsOf(principal: MatrixPrincipal): Permission[] {
  switch (principal) {
    case 'key':
    case 'user':
      return [...PERMISSIONS];
    case 'key:no-scope':
      return PERMISSIONS.filter((permission) => !permission.startsWith('connect-'));
    case 'key:read-only':
      return ['connect-connections:read', 'connect-share-tokens:read'];
    case 'user:no-pii':
      return PERMISSIONS.filter((permission) => permission !== 'pii:view');
    case 'user:no-production':
      return PERMISSIONS.filter((permission) => permission !== 'environments:production');
    case 'user:environment-scoped':
      // C167.2: an environment-scoped assignment grants no organisation-level permission.
      return PERMISSIONS.filter(
        (permission) => !ORGANIZATION_LEVEL_PERMISSIONS.includes(permission),
      );
  }
}

/** One organisation of a scene: its id and its two environments. */
export interface MatrixOrg {
  id: string;
  sandbox: string;
  production: string;
}

/** What a scene holds for the cases to act on. */
export interface MatrixScene {
  orgs: Record<MatrixOrganisation, MatrixOrg>;
  connectionId: string;
  selfConnectionId: string;
  tokens: Record<MatrixKind, string>;
  selfToken: string;
  /** A consent record for a new token (`token.create`), and its source inquiry. */
  fresh: { inquiryId: string; consentRecordId: string };
}

/** A principal of the services' driver, as a route would have resolved it. */
export function principalOf(
  org: MatrixOrg,
  kind: MatrixKind,
  principal: MatrixPrincipal,
): Principal {
  const environmentId = kind === 'sandbox' ? org.sandbox : org.production;
  const permissions = new Set(permissionsOf(principal));
  return principal.startsWith('key')
    ? {
        kind: 'api-key',
        apiKeyId: newId('key'),
        organizationId: org.id,
        environmentId,
        environmentKind: kind,
        permissions,
      }
    : {
        kind: 'user',
        userId: newId('usr'),
        userSessionId: newId('uss'),
        organizationId: org.id,
        environmentId,
        environmentKind: kind,
        permissions,
        mfaSatisfied: true,
      };
}

/** The acting of a principal, as `connectActingOf` builds it from a request. */
export function actingFor(principal: Principal): ConnectActing {
  return {
    principal,
    ctx: { organizationId: principal.organizationId, environmentId: principal.environmentId },
    actor:
      principal.kind === 'api-key'
        ? { type: 'api-key', id: principal.apiKeyId }
        : { type: 'user', id: principal.userId },
    environmentKind: principal.environmentKind,
  };
}

const DAY = 86_400_000;

/** A source inquiry with a passed government ID in `environmentId`. */
async function sourceInquiry(db: Db, environmentId: string): Promise<string> {
  const defaults = defaultInquiryTemplateAttributes();
  const template = await createInquiryTemplate(db, environmentId, {
    id: newId('itmpl'),
    name: 'Example share source',
    version: {
      id: newId('itmplv'),
      flow: defaults.flow,
      verificationConfig: defaults['verification-config'],
    },
  });
  const inquiry = await createInquiry(db, environmentId, {
    id: newId('inq'),
    inquiryTemplateId: template.id,
    inquiryTemplateVersionId: template.currentVersion.id,
  });
  const verification = await createVerification(db, environmentId, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  await setVerificationStatus(db, environmentId, verification.id, { to: 'passed' });
  return inquiry.id;
}

/** A source-side `flow` consent record about the inquiry, naming the recipient. */
async function consentRecord(
  db: Db,
  environmentId: string,
  connectionId: string,
  recipient: string,
  subjectId: string,
  now: Date,
): Promise<string> {
  const id = newId('cnsr');
  await db.insert(consentRecords).values({
    environmentId,
    id,
    side: 'source',
    outcome: 'accepted',
    purpose: 'share.reuse-kyc',
    subjectType: 'inquiry',
    subjectId,
    connectionId,
    recipientOrganizationId: recipient,
    recipientName: 'Example Partner',
    dataCategories: [
      'identity-fields',
      'contact-fields',
      'other-fields',
      'document-images',
      'biometric',
      'check-results',
    ],
    explicitBiometric: true,
    textSha256: 'e'.repeat(64),
    method: 'flow',
    acceptedAt: now,
    expiresAt: new Date(now.getTime() + 30 * DAY),
  });
  return id;
}

/** An active connection from `source` to `destination`, created by the source's production key. */
async function activeConnection(
  deps: ShareTokenDeps,
  source: MatrixOrg,
  destination: MatrixOrg,
  policy: SharePolicyInput,
): Promise<string> {
  const { data } = await createConnectionFor(
    deps,
    actingFor(principalOf(source, 'production', 'key')),
    { 'destination-organization-id': destination.id, 'share-policy': policy },
  );
  const now = deps.clock.now();
  await updateConnection(deps.db, data.id, {
    status: 'active',
    acceptedPolicyId: data.attributes['share-policy'].id,
    activatedAt: now,
    updatedAt: now,
  });
  return data.id;
}

/** A token of `source` over the connection in its environment of `kind`. */
async function token(
  deps: ShareTokenDeps,
  source: MatrixOrg,
  recipient: MatrixOrg,
  connectionId: string,
  kind: MatrixKind,
): Promise<string> {
  const environmentId = kind === 'sandbox' ? source.sandbox : source.production;
  const inquiryId = await sourceInquiry(deps.db, environmentId);
  const consentRecordId = await consentRecord(
    deps.db,
    environmentId,
    connectionId,
    recipient.id,
    inquiryId,
    deps.clock.now(),
  );
  const { data } = await createShareTokenFor(deps, actingFor(principalOf(source, kind, 'key')), {
    'connection-id': connectionId,
    'source-id': inquiryId,
    'consent-record-id': consentRecordId,
  });
  return data.id;
}

/**
 * A scene for one case: the source, the destination (opted in) and a third organisation, an active
 * connection with a token of each kind, a self-connection with a sandbox token, and a fresh consent
 * for a create. `organisation` makes an organisation with both environments in the driver's way.
 */
export async function matrixScene(
  deps: ShareTokenDeps,
  organisation: (name: string, inbound: boolean) => Promise<MatrixOrg>,
  policy: SharePolicyInput,
): Promise<MatrixScene> {
  const source = await organisation('Example Source', false);
  const destination = await organisation('Example Partner', true);
  const third = await organisation('Example Third', true);
  const self = await organisation('Example Self', true);
  const connectionId = await activeConnection(deps, source, destination, policy);
  const selfConnectionId = await activeConnection(deps, self, self, policy);
  const tokens = {
    sandbox: await token(deps, source, destination, connectionId, 'sandbox'),
    production: await token(deps, source, destination, connectionId, 'production'),
  };
  const selfToken = await token(deps, self, self, selfConnectionId, 'sandbox');
  const inquiryId = await sourceInquiry(deps.db, source.sandbox);
  const consentRecordId = await consentRecord(
    deps.db,
    source.sandbox,
    connectionId,
    destination.id,
    inquiryId,
    deps.clock.now(),
  );
  return {
    orgs: { source, destination, third, self },
    connectionId,
    selfConnectionId,
    tokens,
    selfToken,
    fresh: { inquiryId, consentRecordId },
  };
}

/** The ids a case's route acts on. */
export function targetOf(scene: MatrixScene, matrixCase: MatrixCase) {
  const self = matrixCase.organisation === 'self';
  return {
    connectionId: self ? scene.selfConnectionId : scene.connectionId,
    tokenId: self ? scene.selfToken : scene.tokens[matrixCase.token ?? 'sandbox'],
  };
}

/** A readable name of a case. */
export const caseName = (matrixCase: MatrixCase): string =>
  `${matrixCase.route} by the ${matrixCase.organisation}'s ${matrixCase.kind} ${matrixCase.principal} -> ${String(matrixCase.expected)}`;
