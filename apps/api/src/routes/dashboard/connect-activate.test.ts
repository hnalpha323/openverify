/**
 * C231.3 (Workflow 11A, `api-connect` checkpoint 1): the destination's activation in the console,
 * `POST /api/v1/dashboard/connect/connections/:id/activate`. A user session of the destination
 * organisation, `connect-connections:activate` (organisation-level, `admin` only), a second factor
 * verified within the step-up window (403 `step_up_required` otherwise, whatever `require-mfa`),
 * the current policy version (409 `share_policy_changed`) and the agreement reference, sealed at
 * rest. A user of the source organisation gets the one 404. The change is evented in every
 * environment of both organisations and audited on both sides.
 */
import { readFileSync } from 'node:fs';
import { CONNECT_NOT_FOUND_PROBLEM, newId } from '@openverify/contracts';
import {
  connectConnections,
  createConnection,
  events,
  listAuditLogs,
  userSessions,
} from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  type DashboardHarness,
  type TestOrganization,
} from './dashboard.test-support.js';

const POLICY = JSON.parse(
  readFileSync(
    new URL('../../../../../contracts/fixtures/api/connect/share-policy.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;
const REFERENCE = 'Example data-sharing agreement 2026-11 (synthetic)';

let database: TestDatabase;
let api: DashboardHarness;
beforeAll(async () => {
  database = await createTestDatabase();
  api = await createDashboardHarness(database, { connect: { enabled: true } });
}, 120_000);
afterAll(async () => {
  await api.close();
  await database.close();
});

const body = (version = 1) => ({
  data: {
    attributes: { 'policy-version': version, 'agreement-reference': REFERENCE, acknowledged: true },
  },
});

async function pending(): Promise<{
  source: TestOrganization;
  destination: TestOrganization;
  id: string;
}> {
  const source = await api.organization({ production: true });
  const destination = await api.organization({ production: true });
  const id = newId('cxn');
  await database.db.transaction((tx) =>
    createConnection(tx, {
      id,
      sourceOrganizationId: source.id,
      destinationOrganizationId: destination.id,
      creatorType: 'api-key',
      creatorId: newId('key'),
      policyId: newId('cxnp'),
      policy: POLICY,
    }),
  );
  return { source, destination, id };
}

/** An operator of the organisation, signed in; with `stepUp`, its session verified a factor now. */
async function signedIn(
  organization: TestOrganization,
  options: { roles?: ('admin' | 'developer')[]; stepUp?: boolean } = {},
): Promise<string> {
  const { email, user } = await api.operator(organization, { roles: options.roles ?? ['admin'] });
  const token = await api.signIn(email);
  if (options.stepUp !== false) {
    await database.db
      .update(userSessions)
      .set({ mfaVerifiedAt: api.clock.now() })
      .where(eq(userSessions.userId, user.id));
  }
  return token;
}

const activate = (id: string, token: string, payload: unknown = body()) =>
  api.call('POST', `/connect/connections/${id}/activate`, { token, payload });

const generic = (raw: string) =>
  Object.fromEntries(
    Object.entries(JSON.parse(raw) as Record<string, unknown>).filter(
      ([member]) => member !== 'instance' && member !== 'requestId',
    ),
  );

describe('activating a connection (C231.3)', () => {
  it('lets the destination’s admin with a fresh second factor accept the current version', async () => {
    const { destination, id, source } = await pending();
    const response = await activate(id, await signedIn(destination));
    expect(response.statusCode, response.body).toBe(200);
    const { data } = response.json<{ data: { attributes: Record<string, unknown> } }>();
    expect(data.attributes).toMatchObject({
      status: 'active',
      direction: 'inbound',
      'accepted-policy-version': 1,
      'agreement-reference': REFERENCE,
    });
    // integration-11a (api-connect's deviation): the server API's ports reach the activation, so
    // its time is the injected clock's, not the system's.
    expect(data.attributes['activated-at']).toBe(api.clock.now().toISOString());
    const [row] = await database.db
      .select({ sealed: connectConnections.agreementReference })
      .from(connectConnections)
      .where(eq(connectConnections.id, id));
    expect(row?.sealed).not.toContain('synthetic');
    const staged = await database.db
      .select({ environmentId: events.environmentId, name: events.name })
      .from(events)
      .where(eq(events.name, 'connect/connection.activated'));
    const environments = [
      source.sandboxId,
      source.productionId,
      destination.sandboxId,
      destination.productionId,
    ];
    expect(
      staged
        .filter((event) => environments.includes(event.environmentId))
        .map((event) => event.environmentId)
        .sort(),
    ).toEqual([...environments].sort());
    const counterparty = (await listAuditLogs(database.db, source.sandboxId)).filter(
      (entry) => entry.action === 'connect-connection.activated' && entry.resourceId === id,
    );
    expect(counterparty).toHaveLength(1);
    expect(counterparty[0]?.metadata).toMatchObject({
      counterparty: { 'organization-id': destination.id, kind: 'user' },
    });
    const own = (await listAuditLogs(database.db, destination.sandboxId)).filter(
      (entry) => entry.action === 'connect-connection.activated' && entry.resourceId === id,
    );
    expect(own[0]).toMatchObject({ actorType: 'user' });
  });

  it('answers 403 step_up_required to a session that verified no factor within the window', async () => {
    const { destination, id } = await pending();
    const response = await activate(id, await signedIn(destination, { stepUp: false }));
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'step_up_required' });
  });

  it('answers the one 404 to the source organisation’s admin and to a third organisation', async () => {
    const { id, source } = await pending();
    const third = await api.organization();
    for (const organization of [source, third]) {
      const response = await activate(id, await signedIn(organization));
      expect(response.statusCode).toBe(404);
      expect(generic(response.body)).toEqual(CONNECT_NOT_FOUND_PROBLEM);
    }
  });

  it('answers 403 to a user without connect-connections:activate', async () => {
    const { destination, id } = await pending();
    const response = await activate(id, await signedIn(destination, { roles: ['developer'] }));
    expect(response.statusCode).toBe(403);
  });

  it('answers 409 share_policy_changed for another version, and 409 once active', async () => {
    const { destination, id } = await pending();
    const token = await signedIn(destination);
    const stale = await activate(id, token, body(2));
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'share_policy_changed' });
    expect((await activate(id, token)).statusCode).toBe(200);
    const again = await activate(id, token);
    expect(again.statusCode).toBe(409);
  });
});
