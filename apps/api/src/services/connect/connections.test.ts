/**
 * C231 (Workflow 11A, `api-connect` checkpoint 1): connections on the server API, through the routes
 * on PGlite. The source creates (version 1, `pending`, the destination's name hidden until the first
 * activation); an unknown organisation and one that has not opted in get one byte-identical 422; a
 * pair has one connection; both sides list and retrieve, a third organisation gets the one 404; the
 * writes are organisation-level (a sandbox key: the one 404; a user without
 * `environments:production`: 403); deactivation by either side, reactivation by the source, a policy
 * change back to `pending`; every change stages its event in every environment of both organisations
 * with the resource as that side sees it, and its audit entries on both sides, the counterparty's
 * naming only `{organization-id, kind}`.
 */
import { readFileSync } from 'node:fs';
import { CONNECT_NOT_FOUND_PROBLEM, eventPayloadSchema, newId } from '@openverify/contracts';
import { PERMISSIONS, type Permission } from '@openverify/core';
import {
  createEnvironment,
  listAuditLogs,
  organizations,
  setOrganizationConnectInbound,
  updateConnection,
} from '@openverify/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

const POLICY = JSON.parse(
  readFileSync(
    new URL('../../../../../contracts/fixtures/api/connect/share-policy.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

let api: TestApi;
let callCount = 0;

/** One organisation with a production environment (its all-scopes key) and a sandbox one. */
interface Organisation {
  id: string;
  production: string;
  sandbox: string;
  productionKey: string;
  sandboxKey: string;
}

async function organisation(name: string, inbound: boolean): Promise<Organisation> {
  const tenant = await api.newTenant({ kind: 'production' });
  const sandbox = await createEnvironment(api.database.db, {
    id: newId('env'),
    organizationId: tenant.organizationId,
    kind: 'sandbox',
  });
  await api.database.db
    .update(organizations)
    .set({ name })
    .where(eq(organizations.id, tenant.organizationId));
  if (inbound) {
    await setOrganizationConnectInbound(api.database.db, tenant.organizationId, true);
  }
  return {
    id: tenant.organizationId,
    production: tenant.environmentId,
    sandbox: sandbox.id,
    productionKey: tenant.token,
    sandboxKey: await api.newApiKey(sandbox.id),
  };
}

const call = (
  method: 'GET' | 'POST',
  url: string,
  token: string,
  payload?: Record<string, unknown>,
) =>
  api.app.inject({
    method,
    url,
    headers: { ...bearer(token), 'idempotency-key': `synthetic-cxn-${String((callCount += 1))}` },
    ...(payload === undefined ? {} : { payload }),
  });

const create = (token: string, destination: string, policy: Record<string, unknown> = POLICY) =>
  call('POST', '/api/v1/connect/connections', token, {
    data: { attributes: { 'destination-organization-id': destination, 'share-policy': policy } },
  });

/** A problem without its per-request members. */
const genericOf = (body: string) =>
  Object.fromEntries(
    Object.entries(JSON.parse(body) as Record<string, unknown>).filter(
      ([member]) => member !== 'instance' && member !== 'requestId',
    ),
  );

interface ConnectionBody {
  data: {
    id: string;
    attributes: Record<string, unknown> & { 'share-policy': { version: number } };
    relationships: Record<string, unknown>;
  };
}

beforeAll(async () => {
  api = await createTestApi({ connect: { enabled: true } });
}, 120_000);
afterAll(async () => {
  await api.close();
});

describe('creating a connection (C231.1, C231.10)', () => {
  it('answers 201 pending with policy version 1, as the source sees it', async () => {
    const source = await organisation('Example Source', false);
    const destination = await organisation('Example Partner', true);
    const response = await create(source.productionKey, destination.id);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = response.json<ConnectionBody>();
    expect(data.id).toMatch(/^cxn_/);
    expect(data.attributes).toMatchObject({
      status: 'pending',
      direction: 'outbound',
      'source-organization-id': source.id,
      'destination-organization-id': destination.id,
      'source-organization-name': 'Example Source',
      // Review P09: a create is not a name oracle.
      'destination-organization-name': null,
      'accepted-policy-version': null,
      'activated-at': null,
    });
    expect(data.attributes['share-policy'].version).toBe(1);
    expect(data.attributes).not.toHaveProperty('agreement-reference');
    expect(data.relationships).toEqual({
      creator: { data: { type: 'api-key', id: expect.stringMatching(/^key_/) as string } },
    });
  });

  it('answers one byte-identical 422 for an unknown organisation and one not opted in', async () => {
    const source = await organisation('Example Source', false);
    const notOptedIn = await organisation('Example Closed', false);
    const unknown = await create(source.productionKey, newId('org'));
    const closed = await create(source.productionKey, notOptedIn.id);
    expect(unknown.statusCode).toBe(422);
    expect(closed.statusCode).toBe(422);
    expect(genericOf(unknown.body)).toEqual(genericOf(closed.body));
    expect(genericOf(unknown.body)).toMatchObject({ code: 'destination_not_found' });
  });

  it('answers 409 connection_exists for a pair that has one, whatever its status', async () => {
    const source = await organisation('Example Source', false);
    const destination = await organisation('Example Partner', true);
    const first = await create(source.productionKey, destination.id);
    const { data } = first.json<ConnectionBody>();
    await updateConnection(api.database.db, data.id, {
      status: 'inactive',
      deactivatedAt: new Date(),
      deactivatedBy: 'source',
      updatedAt: new Date(),
    });
    const again = await create(source.productionKey, destination.id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'connection_exists' });
  });

  it('allows a self-connection, which its one organisation sees as self', async () => {
    const both = await organisation('Example Self', true);
    const response = await create(both.productionKey, both.id);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = response.json<ConnectionBody>();
    expect(data.attributes).toMatchObject({
      direction: 'self',
      'destination-organization-name': 'Example Self',
      'agreement-reference': null,
    });
    expect(data.relationships).toHaveProperty('creator');
  });

  it('stages connection.created in every environment of both organisations, each with its own view', async () => {
    const source = await organisation('Example Source', false);
    const destination = await organisation('Example Partner', true);
    const before = api.events.named('connect/connection.created').length;
    const response = await create(source.productionKey, destination.id);
    const { data } = response.json<ConnectionBody>();
    const events = api.events
      .named('connect/connection.created')
      .slice(before)
      .filter((event) => (event.payload.data as { id: string }).id === data.id);
    expect(events.map((event) => event.environmentId).sort()).toEqual(
      [source.production, source.sandbox, destination.production, destination.sandbox].sort(),
    );
    for (const event of events) {
      expect(() => eventPayloadSchema.parse(event.payload)).not.toThrow();
      const attributes = (event.payload.data as ConnectionBody['data']).attributes;
      const mine =
        event.environmentId === source.production || event.environmentId === source.sandbox;
      expect(attributes.direction).toBe(mine ? 'outbound' : 'inbound');
      if (!mine) {
        // C239.2: never the agreement reference in an event.
        expect(attributes['agreement-reference']).toBeNull();
        expect(attributes['source-organization-name']).toBe('Example Source');
      }
    }
  });

  it('records the audit entry with its actor at the source, and only {organization-id, kind} at the destination', async () => {
    const source = await organisation('Example Source', false);
    const destination = await organisation('Example Partner', true);
    const { data } = (await create(source.productionKey, destination.id)).json<ConnectionBody>();
    const own = api.audit.withAction('connect-connection.created');
    expect(own.at(-1)).toMatchObject({
      environmentId: source.production,
      resourceType: 'connect-connection',
      resourceId: data.id,
      actor: { type: 'api-key' },
    });
    for (const environment of [destination.production, destination.sandbox]) {
      const entries = (await listAuditLogs(api.database.db, environment)).filter(
        (entry) => entry.action === 'connect-connection.created' && entry.resourceId === data.id,
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actorType: 'system', actorId: null });
      expect(entries[0]?.metadata).toEqual({
        counterparty: { 'organization-id': source.id, kind: 'api-key' },
        'share-policy-id': expect.stringMatching(/^cxnp_/) as string,
      });
    }
  });
});

describe('organisation-level writes (C231.9)', () => {
  it('answers the one generic 404 to a sandbox key', async () => {
    const source = await organisation('Example Source', false);
    const destination = await organisation('Example Partner', true);
    const response = await create(source.sandboxKey, destination.id);
    expect(response.statusCode).toBe(404);
    expect(genericOf(response.body)).toEqual(CONNECT_NOT_FOUND_PROBLEM);
  });

  it('answers 403 to a user without environments:production', async () => {
    const source = await organisation('Example Source', false);
    const destination = await organisation('Example Partner', true);
    const permissions = PERMISSIONS.filter(
      (permission) => permission !== 'environments:production',
    ) as Permission[];
    const user = api.newUserToken(source.production, { permissions });
    const refused = await create(user, destination.id);
    expect(refused.statusCode).toBe(403);
    const allowed = await create(api.newUserToken(source.production), destination.id);
    expect(allowed.statusCode, allowed.body).toBe(201);
    expect(allowed.json<ConnectionBody>().data.relationships).toEqual({
      creator: { data: { type: 'user', id: expect.stringMatching(/^usr_/) as string } },
    });
  });
});

describe('listing and retrieving (C231.2)', () => {
  it('shows each side its view, and a third organisation the one 404', async () => {
    const source = await organisation('Example Source', false);
    const destination = await organisation('Example Partner', true);
    const third = await organisation('Example Third', true);
    const { data } = (await create(source.productionKey, destination.id)).json<ConnectionBody>();

    const inbound = await call(
      'GET',
      `/api/v1/connect/connections/${data.id}`,
      destination.sandboxKey,
    );
    expect(inbound.statusCode, inbound.body).toBe(200);
    expect(inbound.json<ConnectionBody>().data).toMatchObject({
      attributes: {
        direction: 'inbound',
        'source-organization-name': 'Example Source',
        'destination-organization-name': 'Example Partner',
        'agreement-reference': null,
      },
      relationships: {},
    });

    const unseen = await call('GET', `/api/v1/connect/connections/${data.id}`, third.productionKey);
    expect(unseen.statusCode).toBe(404);
    expect(genericOf(unseen.body)).toEqual(CONNECT_NOT_FOUND_PROBLEM);

    const listed = await call('GET', '/api/v1/connect/connections', destination.productionKey);
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ data: { id: string }[] }>().data.map((item) => item.id)).toEqual([
      data.id,
    ]);
    expect(
      (await call('GET', '/api/v1/connect/connections', third.productionKey)).json<{
        data: unknown[];
      }>().data,
    ).toEqual([]);
  });

  it('lists newest first in both directions, with the vendor’s filters and cursor pages', async () => {
    const me = await organisation('Example Middle', true);
    const upstream = await organisation('Example Upstream', false);
    const downstream = await organisation('Example Downstream', true);
    const first = (await create(upstream.productionKey, me.id)).json<ConnectionBody>().data.id;
    api.clock.advance(1000);
    const second = (await create(me.productionKey, downstream.id)).json<ConnectionBody>().data.id;
    const page1 = await call('GET', '/api/v1/connect/connections?page[size]=1', me.productionKey);
    const body1 = page1.json<{ data: { id: string }[]; links: { next: string | null } }>();
    expect(body1.data.map((item) => item.id)).toEqual([second]);
    expect(body1.links.next).not.toBeNull();
    const page2 = await call('GET', body1.links.next ?? '', me.productionKey);
    expect(page2.json<{ data: { id: string }[] }>().data.map((item) => item.id)).toEqual([first]);
    const filtered = await call(
      'GET',
      `/api/v1/connect/connections?filter[destination-organization-id]=${downstream.id}&filter[status]=pending`,
      me.productionKey,
    );
    expect(filtered.json<{ data: { id: string }[] }>().data.map((item) => item.id)).toEqual([
      second,
    ]);
    const badCursor = await call(
      'GET',
      `/api/v1/connect/connections?page[after]=${newId('cxn')}`,
      me.productionKey,
    );
    expect(badCursor.statusCode).toBe(400);
  });
});

describe('deactivating, reactivating and changing the policy (C231.4-C231.6)', () => {
  async function activeConnection() {
    const source = await organisation('Example Source', false);
    const destination = await organisation('Example Partner', true);
    const { data } = (await create(source.productionKey, destination.id)).json<ConnectionBody>();
    const now = api.clock.now();
    await updateConnection(api.database.db, data.id, {
      status: 'active',
      acceptedPolicyId: (data.attributes['share-policy'] as unknown as { id: string }).id,
      activatedAt: now,
      updatedAt: now,
    });
    return { source, destination, id: data.id };
  }

  it('lets either side deactivate once (409 connection_not_active after), recording the side', async () => {
    const { destination, id, source } = await activeConnection();
    const response = await call(
      'POST',
      `/api/v1/connect/connections/${id}/deactivate`,
      destination.productionKey,
      {},
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<ConnectionBody>().data.attributes).toMatchObject({
      status: 'inactive',
      'deactivated-by': 'destination',
      direction: 'inbound',
    });
    const again = await call(
      'POST',
      `/api/v1/connect/connections/${id}/deactivate`,
      source.productionKey,
      {},
    );
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'connection_not_active' });
    const events = api.events
      .named('connect/connection.deactivated')
      .filter((event) => (event.payload.data as { id: string }).id === id);
    expect(events).toHaveLength(4);
  });

  it('lets only the source reactivate an inactive connection, back to pending', async () => {
    const { destination, id, source } = await activeConnection();
    const notInactive = await call(
      'POST',
      `/api/v1/connect/connections/${id}/reactivate`,
      source.productionKey,
      {},
    );
    expect(notInactive.statusCode).toBe(409);
    await call('POST', `/api/v1/connect/connections/${id}/deactivate`, source.productionKey, {});
    const byDestination = await call(
      'POST',
      `/api/v1/connect/connections/${id}/reactivate`,
      destination.productionKey,
      {},
    );
    expect(byDestination.statusCode).toBe(404);
    const bySource = await call(
      'POST',
      `/api/v1/connect/connections/${id}/reactivate`,
      source.productionKey,
      {},
    );
    expect(bySource.statusCode, bySource.body).toBe(200);
    expect(bySource.json<ConnectionBody>().data.attributes).toMatchObject({
      status: 'pending',
      'deactivated-at': null,
      'deactivated-by': null,
      // Shown to the source since the first activation.
      'destination-organization-name': 'Example Partner',
    });
  });

  it('writes version n+1 on a policy change and returns an active connection to pending', async () => {
    const { destination, id, source } = await activeConnection();
    const policy = {
      ...POLICY,
      biometric: false,
      verifications: { ...(POLICY.verifications as object), types: ['government-id'] },
    };
    const response = await call(
      'POST',
      `/api/v1/connect/connections/${id}/share-policy`,
      source.productionKey,
      { data: { attributes: { 'share-policy': policy } } },
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<ConnectionBody>().data.attributes).toMatchObject({
      status: 'pending',
      'accepted-policy-version': 1,
      'share-policy': { version: 2 },
    });
    const byDestination = await call(
      'POST',
      `/api/v1/connect/connections/${id}/share-policy`,
      destination.productionKey,
      { data: { attributes: { 'share-policy': policy } } },
    );
    expect(byDestination.statusCode).toBe(404);
    expect(
      api.events
        .named('connect/connection.share-policy-changed')
        .filter((event) => (event.payload.data as { id: string }).id === id),
    ).toHaveLength(4);
  });

  it('refuses every write from a sandbox key with the one 404, and reads from it', async () => {
    const { id, source } = await activeConnection();
    for (const path of ['deactivate', 'reactivate']) {
      const response = await call(
        'POST',
        `/api/v1/connect/connections/${id}/${path}`,
        source.sandboxKey,
        {},
      );
      expect(response.statusCode).toBe(404);
      expect(genericOf(response.body)).toEqual(CONNECT_NOT_FOUND_PROBLEM);
    }
    expect(
      (await call('GET', `/api/v1/connect/connections/${id}`, source.sandboxKey)).statusCode,
    ).toBe(200);
  });
});
