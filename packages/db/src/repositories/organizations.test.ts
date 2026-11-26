import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, testId, type TestDatabase } from '../testing.js';
import {
  createEnvironment,
  createOrganization,
  findEnvironmentByKind,
  getEnvironment,
  getOrganization,
} from './organizations.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

describe('organizations and environments', () => {
  it('creates and reads an organization with its sandbox and production environments', async () => {
    const organization = await createOrganization(database.db, {
      id: testId('org'),
      name: 'Example Org',
    });
    const sandbox = await createEnvironment(database.db, {
      id: testId('env'),
      organizationId: organization.id,
      kind: 'sandbox',
    });
    const production = await createEnvironment(database.db, {
      id: testId('env'),
      organizationId: organization.id,
      kind: 'production',
    });

    expect(await getOrganization(database.db, organization.id)).toEqual(organization);
    expect(await getEnvironment(database.db, sandbox.id)).toEqual(sandbox);
    expect(await findEnvironmentByKind(database.db, organization.id, 'production')).toEqual(
      production,
    );
    expect(organization).toMatchObject({ name: 'Example Org' });
    expect(organization.createdAt).toBeInstanceOf(Date);
  });

  it('returns null for unknown ids', async () => {
    expect(await getOrganization(database.db, testId('org'))).toBeNull();
    expect(await getEnvironment(database.db, testId('env'))).toBeNull();
    expect(await findEnvironmentByKind(database.db, testId('org'), 'sandbox')).toBeNull();
  });
});
