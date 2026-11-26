/**
 * C244.1 (Workflow 11A, `api-connect` checkpoint 4): `seed:dev --connect` seeds the sample partner
 * "Example Partner" (both environments, opted in, labelled a sample, one operator per built-in role)
 * and a pending connection from the dev organisation with a sample policy; a second run reuses it;
 * the printout holds ids and emails, never a password or a secret.
 */
import { newId, storedSharePolicySchema } from '@openverify/contracts';
import { BUILTIN_ROLE_KEYS } from '@openverify/core';
import {
  connectConnections,
  connectSharePolicies,
  createOrganization,
  getOrganization,
  listEnvironments,
} from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SAMPLE_PARTNER_DISPLAY_NAME,
  SAMPLE_SHARE_POLICY,
  formatConnectSeedResult,
  partnerEmail,
  seedConnectPartner,
} from './connect-seed.js';
import { parseDevSeedArgs } from './dev-seed.js';

const hasher = {
  hash: (password: string) => Promise.resolve(`$argon2id$v=19$synthetic-hash:${password}`),
};
const OPERATORS = BUILTIN_ROLE_KEYS.map((role) => ({
  role,
  email: `${role}@example.com`,
  password: `synthetic-password-${role}`,
}));

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);
afterAll(async () => {
  await database.close();
});

describe('seed:dev --connect (C244.1)', () => {
  it('reads the flag beside --json and --mfa-admin', () => {
    expect(parseDevSeedArgs(['--connect'])).toEqual({
      json: false,
      mfaAdmin: false,
      connect: true,
    });
    expect(parseDevSeedArgs([])).toMatchObject({ connect: false });
  });

  it('seeds the sample partner and a pending connection to it, and reuses them on a second run', async () => {
    const dev = await createOrganization(database.db, {
      id: newId('org'),
      name: 'Example Dev Org',
      requireMfa: false,
    });
    const options = {
      db: database.db,
      sourceOrganizationId: dev.id,
      creatorUserId: newId('usr'),
      operators: OPERATORS,
      hasher,
    };
    const first = await seedConnectPartner(options);
    expect(first.created).toBe(true);
    expect(first.name).toBe('Example Partner');
    const partner = await getOrganization(database.db, first.organizationId);
    expect(partner).toMatchObject({ connectInbound: true, requireMfa: false });
    const environments = await listEnvironments(database.db, first.organizationId);
    expect(environments.map((environment) => environment.kind).sort()).toEqual([
      'production',
      'sandbox',
    ]);
    for (const environment of environments) {
      expect(environment.settings['organization-display-name']).toBe(SAMPLE_PARTNER_DISPLAY_NAME);
    }
    expect(first.users.map((user) => [user.role, user.email])).toEqual(
      OPERATORS.map((operator) => [operator.role, partnerEmail(operator.email)]),
    );
    const [connection] = await database.db
      .select()
      .from(connectConnections)
      .where(eq(connectConnections.id, first.connection.id));
    expect(connection).toMatchObject({
      sourceOrganizationId: dev.id,
      destinationOrganizationId: first.organizationId,
      status: 'pending',
      creatorType: 'user',
    });
    const [policy] = await database.db
      .select()
      .from(connectSharePolicies)
      .where(eq(connectSharePolicies.connectionId, first.connection.id));
    expect(storedSharePolicySchema.parse(policy?.body)).toEqual(SAMPLE_SHARE_POLICY);
    expect(policy?.version).toBe(1);

    const second = await seedConnectPartner(options);
    expect(second).toMatchObject({
      created: false,
      organizationId: first.organizationId,
      connection: { id: first.connection.id, created: false },
    });
    expect(second.users.every((user) => !user.created)).toBe(true);
  });

  it('prints ids and emails, never a password', async () => {
    const dev = await createOrganization(database.db, {
      id: newId('org'),
      name: 'Example Dev Org Two',
      requireMfa: false,
    });
    const result = await seedConnectPartner({
      db: database.db,
      sourceOrganizationId: dev.id,
      creatorUserId: newId('usr'),
      operators: OPERATORS.map((operator) => ({
        ...operator,
        email: operator.email.replace('@', '.two@'),
      })),
      hasher,
    });
    const printed = formatConnectSeedResult(result);
    expect(printed).toContain(result.organizationId);
    expect(printed).toContain(result.connection.id);
    expect(printed).toContain('sample');
    expect(printed).not.toContain('synthetic-password');
    expect(printed).not.toContain('synthetic-hash');
  });
});
