/**
 * C125 (Workflow 8A): the secrets' repository on the real schema. Each function acts on its own
 * organisation or environment, a value is sealed for its row and comes out in one place, and a
 * rotation keeps the old value until its expiry. Every value is a synthetic canary.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { SEALED } from '../encrypted-columns.js';
import { workflowSecretValues } from '../schema.js';
import { openValue } from '../sealed.js';
import {
  createTestDatabase,
  createTestTenant,
  seedWorkflow,
  seedWorkflowVersion,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  createWorkflowSecret,
  deleteWorkflowSecret,
  findWorkflowSecretReference,
  getWorkflowSecret,
  getWorkflowSecretValueMeta,
  listWorkflowSecretFacts,
  listWorkflowSecrets,
  listWorkflowSecretValueEnvironments,
  listWorkflowSecretValueMetas,
  lockWorkflowSecret,
  openWorkflowSecretValue,
  putWorkflowSecretValue,
  rotateWorkflowSecretValue,
  updateWorkflowSecret,
} from './workflow-secrets.js';

let database: TestDatabase;
const CANARY = 'canary-synthetic-secret-value';
const NOW = new Date('2026-11-02T12:00:00.000Z');

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const newSecret = (more: Partial<Parameters<typeof createWorkflowSecret>[2]> = {}) => ({
  id: testId('wsec'),
  key: `key_${testId('wsec').slice(-10).toLowerCase()}`,
  allowedHosts: ['api.example.com'],
  createdBy: testId('usr'),
  ...more,
});

async function secretIn() {
  const tenant = await createTestTenant(database.db);
  const secret = await createWorkflowSecret(database.db, tenant.organization.id, newSecret());
  return {
    organizationId: tenant.organization.id,
    environmentId: tenant.environment.id,
    secret,
  };
}

const valueInput = (seeded: Awaited<ReturnType<typeof secretIn>>, value = CANARY) => ({
  id: testId('wsecv'),
  organizationId: seeded.organizationId,
  secretId: seeded.secret.id,
  environmentId: seeded.environmentId,
  value,
  actorId: testId('usr'),
});

describe('a secret', () => {
  it('is created with the default placements, and read by its key', async () => {
    const seeded = await secretIn();

    const read = await getWorkflowSecret(database.db, seeded.organizationId, seeded.secret.key);

    expect(read).toMatchObject({
      id: seeded.secret.id,
      allowedHosts: ['api.example.com'],
      allowedPlacements: { headers: ['authorization'], 'body-pointers': [] },
    });
  });

  it('takes the placements it is given', async () => {
    const { organization } = await createTestTenant(database.db);
    const placements = { headers: ['x-token'], 'body-pointers': ['/token'] };

    const secret = await createWorkflowSecret(
      database.db,
      organization.id,
      newSecret({ allowedPlacements: placements, description: 'CRM' }),
    );

    expect(secret).toMatchObject({ allowedPlacements: placements, description: 'CRM' });
  });

  it('is unique per organisation, and two organisations can share a key', async () => {
    const first = await secretIn();
    const other = await createTestTenant(database.db);

    await expect(
      createWorkflowSecret(database.db, first.organizationId, newSecret({ key: first.secret.key })),
    ).rejects.toThrow();
    await expect(
      createWorkflowSecret(
        database.db,
        other.organization.id,
        newSecret({ key: first.secret.key }),
      ),
    ).resolves.toMatchObject({ key: first.secret.key });
  });

  it('reads as nothing from another organisation', async () => {
    const seeded = await secretIn();
    const other = await createTestTenant(database.db);

    expect(
      await getWorkflowSecret(database.db, other.organization.id, seeded.secret.key),
    ).toBeNull();
    await database.db.transaction(async (tx) => {
      expect(await lockWorkflowSecret(tx, other.organization.id, seeded.secret.key)).toBeNull();
      expect(await lockWorkflowSecret(tx, seeded.organizationId, seeded.secret.key)).toMatchObject({
        id: seeded.secret.id,
      });
    });
  });

  it('lists newest first, with a cursor, ties broken by id', async () => {
    const { organization } = await createTestTenant(database.db);
    const at = new Date('2026-11-01T00:00:00.000Z');
    const ids = [testId('wsec'), testId('wsec'), testId('wsec')].sort();
    for (const id of ids) {
      await createWorkflowSecret(database.db, organization.id, newSecret({ id }));
    }
    await database.db.execute(
      sql`update workflow_secrets set created_at = ${at.toISOString()}::timestamptz
           where organization_id = ${organization.id}`,
    );

    const first = await listWorkflowSecrets(database.db, organization.id, { size: 2 });
    const second = await listWorkflowSecrets(database.db, organization.id, {
      size: 2,
      after: first.next ?? undefined,
    });

    expect(first.items.map(({ id }) => id)).toEqual([ids[2], ids[1]]);
    expect(second.items.map(({ id }) => id)).toEqual([ids[0]]);
    expect(second.next).toBeNull();
  });

  it('changes what it is given, its key never', async () => {
    const seeded = await secretIn();

    const changed = await updateWorkflowSecret(
      database.db,
      seeded.organizationId,
      seeded.secret.id,
      { description: null, allowedHosts: ['other.example.com'] },
    );

    expect(changed).toMatchObject({
      key: seeded.secret.key,
      description: null,
      allowedHosts: ['other.example.com'],
    });
  });

  it('takes its values with it when deleted', async () => {
    const seeded = await secretIn();
    await database.db.transaction((tx) => putWorkflowSecretValue(tx, valueInput(seeded)));

    await database.db.transaction((tx) =>
      deleteWorkflowSecret(tx, seeded.organizationId, seeded.secret.id),
    );

    expect(
      await getWorkflowSecret(database.db, seeded.organizationId, seeded.secret.key),
    ).toBeNull();
    expect(
      await database.db
        .select()
        .from(workflowSecretValues)
        .where(eq(workflowSecretValues.secretId, seeded.secret.id)),
    ).toEqual([]);
  });
});

describe('a value', () => {
  it('is sealed for its row, and its metadata holds no value', async () => {
    const seeded = await secretIn();
    const input = valueInput(seeded);

    const meta = await database.db.transaction((tx) => putWorkflowSecretValue(tx, input));

    expect(JSON.stringify(meta)).not.toContain(CANARY);
    expect(meta).toMatchObject({ id: input.id, version: 1, last4: 'alue', rotatedAt: null });
    const [row] = await database.db
      .select()
      .from(workflowSecretValues)
      .where(eq(workflowSecretValues.id, input.id));
    expect(row?.value).not.toContain(CANARY);
    expect(openValue(SEALED.workflowSecretValue, input.id, row?.value as never)).toBe(CANARY);
  });

  it.each([
    ['a', '****'],
    ['abcd', '****'],
    ['abcdefg', '****'],
    ['abcdefgh', 'efgh'],
  ])('keeps of %s the last four %s, never a short value whole', async (value, last4) => {
    const seeded = await secretIn();

    const meta = await database.db.transaction((tx) =>
      putWorkflowSecretValue(tx, valueInput(seeded, value)),
    );

    expect(meta.last4).toBe(last4);
  });

  it('keeps its row and takes the next version on a second put', async () => {
    const seeded = await secretIn();
    const first = await database.db.transaction((tx) =>
      putWorkflowSecretValue(tx, valueInput(seeded)),
    );

    const second = await database.db.transaction((tx) =>
      putWorkflowSecretValue(tx, valueInput(seeded, 'canary-second-value')),
    );

    expect(second).toMatchObject({ id: first.id, version: 2 });
    expect(
      await openWorkflowSecretValue(database.db, seeded.environmentId, seeded.secret.id, NOW),
    ).toEqual({ value: 'canary-second-value', previousValue: null });
  });

  it('opens in its own environment and no other', async () => {
    const seeded = await secretIn();
    await database.db.transaction((tx) => putWorkflowSecretValue(tx, valueInput(seeded)));
    const other = await createTestTenant(database.db);

    expect(
      await openWorkflowSecretValue(database.db, seeded.environmentId, seeded.secret.id, NOW),
    ).toEqual({ value: CANARY, previousValue: null });
    expect(
      await openWorkflowSecretValue(database.db, other.environment.id, seeded.secret.id, NOW),
    ).toBeNull();
  });

  it('cannot be written for another organisation’s environment', async () => {
    const seeded = await secretIn();
    const other = await createTestTenant(database.db);

    await expect(
      database.db.transaction((tx) =>
        putWorkflowSecretValue(tx, {
          ...valueInput(seeded),
          environmentId: other.environment.id,
        }),
      ),
    ).rejects.toThrow();
  });

  it('reads its metadata one at a time and by the page', async () => {
    const seeded = await secretIn();
    const meta = await database.db.transaction((tx) =>
      putWorkflowSecretValue(tx, valueInput(seeded)),
    );

    expect(
      await getWorkflowSecretValueMeta(database.db, seeded.environmentId, seeded.secret.id),
    ).toMatchObject({ id: meta.id });
    expect(
      await listWorkflowSecretValueMetas(database.db, seeded.environmentId, [seeded.secret.id]),
    ).toMatchObject([{ id: meta.id }]);
    expect(await listWorkflowSecretValueMetas(database.db, seeded.environmentId, [])).toEqual([]);
    expect(
      await getWorkflowSecretValueMeta(database.db, testId('env'), seeded.secret.id),
    ).toBeNull();
  });

  it('names the environments holding one', async () => {
    const seeded = await secretIn();
    await database.db.transaction((tx) => putWorkflowSecretValue(tx, valueInput(seeded)));

    expect(await listWorkflowSecretValueEnvironments(database.db, seeded.secret.id)).toEqual([
      { environmentId: seeded.environmentId },
    ]);
  });
});

describe('a rotation (C125.2, C124.6)', () => {
  const ROTATED_AT = new Date('2026-11-02T11:00:00.000Z');
  const EXPIRES = new Date('2026-11-03T11:00:00.000Z');

  async function rotated() {
    const seeded = await secretIn();
    await database.db.transaction((tx) => putWorkflowSecretValue(tx, valueInput(seeded)));
    const actorId = testId('usr');
    const meta = await database.db.transaction((tx) =>
      rotateWorkflowSecretValue(tx, {
        ...valueInput(seeded, 'canary-rotated-value'),
        actorId,
        rotatedAt: ROTATED_AT,
        previousExpiresAt: EXPIRES,
      }),
    );
    return { seeded, meta, actorId };
  }

  it('keeps the old value until its expiry', async () => {
    const { seeded, meta, actorId } = await rotated();

    expect(meta).toMatchObject({
      version: 2,
      rotatedBy: actorId,
      rotatedAt: ROTATED_AT,
      previousExpiresAt: EXPIRES,
    });
    expect(
      await openWorkflowSecretValue(database.db, seeded.environmentId, seeded.secret.id, NOW),
    ).toEqual({ value: 'canary-rotated-value', previousValue: CANARY });
  });

  it('reads the old value as null once it has expired', async () => {
    const { seeded } = await rotated();
    const later = new Date(EXPIRES.getTime() + 1);

    expect(
      await openWorkflowSecretValue(database.db, seeded.environmentId, seeded.secret.id, later),
    ).toEqual({ value: 'canary-rotated-value', previousValue: null });
  });

  it('seals the old value for its own column and row', async () => {
    const { seeded, meta } = await rotated();
    const [row] = await database.db
      .select()
      .from(workflowSecretValues)
      .where(eq(workflowSecretValues.secretId, seeded.secret.id));

    expect(
      openValue(SEALED.workflowSecretPreviousValue, meta.id, row?.previousValue as never),
    ).toBe(CANARY);
  });

  it('refuses when no value exists to rotate', async () => {
    const seeded = await secretIn();

    await expect(
      database.db.transaction((tx) =>
        rotateWorkflowSecretValue(tx, {
          ...valueInput(seeded),
          rotatedAt: ROTATED_AT,
          previousExpiresAt: EXPIRES,
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('what publishing reads (C125.3, C116.4)', () => {
  it('states each secret’s hosts, placements and whether this environment holds a value', async () => {
    const seeded = await secretIn();
    const without = await createWorkflowSecret(database.db, seeded.organizationId, newSecret());
    await database.db.transaction((tx) => putWorkflowSecretValue(tx, valueInput(seeded)));

    const facts = await listWorkflowSecretFacts(
      database.db,
      seeded.organizationId,
      seeded.environmentId,
    );

    expect(facts.get(seeded.secret.key)).toEqual({
      allowedHosts: ['api.example.com'],
      headers: ['authorization'],
      bodyPointers: [],
      hasValue: true,
    });
    expect(facts.get(without.key)?.hasValue).toBe(false);
  });
});

describe('findWorkflowSecretReference (C125.2)', () => {
  const definitionWith = (reference: string) => ({
    'schema-version': 1,
    steps: [{ id: 'call', config: { headers: [{ name: 'authorization', value: reference }] } }],
  });

  async function versionWith(reference: string, status: 'draft' | 'published' | 'archived') {
    const seeded = await secretIn();
    const workflow = await seedWorkflow(database.db, seeded.environmentId);
    const version = await seedWorkflowVersion(database.db, seeded.environmentId, {
      workflowId: workflow.id,
      status: status === 'draft' ? 'draft' : 'published',
      definition: definitionWith(reference.replaceAll('KEY', seeded.secret.key)),
    });
    if (status === 'archived') {
      await database.db.execute(
        sql`update workflow_versions set status = 'archived' where id = ${version.id}`,
      );
    }
    return seeded;
  }

  it.each([
    ['{{secrets.KEY}}'],
    ['{{ secrets.KEY }}'],
    ['Bearer {{secrets.KEY}}'],
    ['{{current_run.environment.secrets.KEY}}'],
  ])('finds %s in a published version', async (reference) => {
    const seeded = await versionWith(reference, 'published');

    expect(
      await findWorkflowSecretReference(database.db, seeded.organizationId, seeded.secret.key),
    ).toBe(true);
  });

  it.each(['draft', 'archived'] as const)('leaves a %s version out', async (status) => {
    const seeded = await versionWith('{{secrets.KEY}}', status);

    expect(
      await findWorkflowSecretReference(database.db, seeded.organizationId, seeded.secret.key),
    ).toBe(false);
  });

  it('never takes another key that starts the same, or text naming no reference', async () => {
    const seeded = await versionWith('{{secrets.KEY_two}} and secrets.KEY', 'published');

    expect(
      await findWorkflowSecretReference(database.db, seeded.organizationId, seeded.secret.key),
    ).toBe(false);
  });

  it('reads every environment of the organisation, and no other organisation', async () => {
    const seeded = await versionWith('{{secrets.KEY}}', 'published');
    const other = await createTestTenant(database.db);

    expect(
      await findWorkflowSecretReference(database.db, other.organization.id, seeded.secret.key),
    ).toBe(false);
  });
});
