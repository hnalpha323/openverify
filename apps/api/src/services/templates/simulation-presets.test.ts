/**
 * C156.4 (Workflow 9B, api-templates-carry): the built-in simulation presets, resolved against a
 * version's own verification steps, and a user's own presets: listed after the built-in ones newest
 * first, theirs alone, sealed at rest and served with the scope masked to a reader without
 * `pii:view`. Every value is synthetic.
 */
import {
  defaultInquiryTemplateAttributes,
  simulationPresetResourceSchema,
  SIMULATION_PRESET_LABEL,
} from '@openverify/contracts';
import { createSimulationPreset, createUser, simulationPresets } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { migrateFlow } from '@openverify/flow-spec';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError } from '../../errors.js';
import { simulateFlow } from './simulate.js';
import {
  BUILT_IN_SIMULATION_PRESETS,
  builtInPresetScope,
  deleteOwnSimulationPreset,
  listSimulationPresetResources,
  presetScopeFor,
  saveSimulationPreset,
  type PresetReader,
} from './simulation-presets.js';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const defaults = defaultInquiryTemplateAttributes();
const flow = migrateFlow(defaults.flow);

describe('the built-in presets (C156.4)', () => {
  it('holds a passing and a failing preset per verification type, by the API type names', () => {
    const ids = BUILT_IN_SIMULATION_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const type of ['government-id', 'selfie', 'document', 'phone-number', 'database']) {
      expect(ids).toEqual(
        expect.arrayContaining([`builtin:${type}-passed`, `builtin:${type}-failed`]),
      );
    }
    expect(ids).toHaveLength(22);
    for (const id of ids) expect(id).toMatch(/^builtin:[a-z0-9_-]{1,80}$/);
  });

  it("resolves against the version's own steps: the named type fails, every other one passes", () => {
    expect(builtInPresetScope('builtin:government-id-failed', flow, NOW)).toEqual({
      verifications: { government_id: { status: 'failed' }, selfie: { status: 'passed' } },
    });
    const failed = simulateFlow(
      flow,
      builtInPresetScope('builtin:selfie-failed', flow, NOW) ?? {},
      {
        verificationConfig: defaults['verification-config'],
        fieldSchemas: [],
        now: NOW,
      },
    );
    expect(failed.outcome.status).toBe('failed');
  });

  it('gives a passing government ID synthetic extracted values, an adult whose ID is current', () => {
    const scope = builtInPresetScope('builtin:government-id-passed', flow, NOW);
    expect(scope?.verifications?.government_id).toEqual({
      status: 'passed',
      extractions: {
        'country-code': 'US',
        'id-class': 'dl',
        birthdate: '1996-11-05',
        'expiration-date': '2031-11-05',
      },
    });
    expect(scope?.verifications?.selfie).toEqual({ status: 'passed' });
  });

  it('answers null for an id that names no built-in preset', () => {
    expect(builtInPresetScope('builtin:nothing-passed', flow, NOW)).toBeNull();
    expect(builtInPresetScope('ssp_01M5CN00000000000000009B10', flow, NOW)).toBeNull();
  });
});

describe("a user's own presets (C156.4, C174.5)", () => {
  let database: TestDatabase;
  let environmentId: string;
  let owner: PresetReader;
  let stranger: PresetReader;

  beforeAll(async () => {
    database = await createTestDatabase();
    const { organization, environment } = await createTestTenant(database.db);
    environmentId = environment.id;
    const user = async () =>
      (
        await createUser(database.db, {
          id: testId('usr'),
          organizationId: organization.id,
          email: `${testId('usr').toLowerCase()}@example.com`,
          passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
        })
      ).id;
    owner = { environmentId, userId: await user(), piiVisible: true };
    stranger = { environmentId, userId: await user(), piiVisible: true };
  });

  afterAll(async () => {
    await database.close();
  });

  const SCOPE = { fields: { name_first: 'Synthetic' } };

  it('lists the built-in presets first, then the reader’s own, each labelled synthetic', async () => {
    const saved = await saveSimulationPreset(database.db, owner, {
      id: testId('ssp'),
      name: 'Synthetic minor',
      scope: SCOPE,
    });
    expect(saved).toMatchObject({
      type: 'simulation-preset',
      attributes: {
        name: 'Synthetic minor',
        label: SIMULATION_PRESET_LABEL,
        'built-in': false,
        scope: SCOPE,
      },
    });
    const listed = await listSimulationPresetResources(database.db, owner);
    for (const resource of listed) simulationPresetResourceSchema.parse(resource);
    expect(listed.slice(0, BUILT_IN_SIMULATION_PRESETS.length).map(({ id }) => id)).toEqual(
      BUILT_IN_SIMULATION_PRESETS.map(({ id }) => id),
    );
    expect(listed.at(-1)?.id).toBe(saved.id);
    expect(listed[0]?.attributes).toMatchObject({
      'built-in': true,
      scope: null,
      'created-at': null,
    });
    const theirs = await listSimulationPresetResources(database.db, stranger);
    expect(theirs.map(({ id }) => id)).not.toContain(saved.id);
  });

  it('masks the scope to a reader without pii:view, and keeps it sealed at rest', async () => {
    const saved = await saveSimulationPreset(database.db, owner, {
      id: testId('ssp'),
      name: 'Synthetic adult',
      scope: SCOPE,
    });
    const masked = await listSimulationPresetResources(database.db, {
      ...owner,
      piiVisible: false,
    });
    expect(masked.find(({ id }) => id === saved.id)?.attributes.scope).toBeNull();
    const [row] = await database.db
      .select()
      .from(simulationPresets)
      .where(eq(simulationPresets.id, saved.id));
    expect(JSON.stringify(row)).not.toContain('Synthetic"');
  });

  it("resolves the reader's own preset for simulate, and never another user's", async () => {
    const preset = await createSimulationPreset(database.db, environmentId, {
      id: testId('ssp'),
      userId: owner.userId ?? '',
      name: 'Synthetic pass',
      scope: { verifications: { government_id: { status: 'passed' } } },
    });
    await expect(presetScopeFor(database.db, owner, preset.id, flow, NOW)).resolves.toEqual({
      verifications: { government_id: { status: 'passed' } },
    });
    await expect(
      presetScopeFor(database.db, stranger, preset.id, flow, NOW),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      presetScopeFor(database.db, { ...owner, userId: null }, preset.id, flow, NOW),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      presetScopeFor(database.db, owner, 'builtin:selfie-failed', flow, NOW),
    ).resolves.toMatchObject({ verifications: { selfie: { status: 'failed' } } });
    await expect(
      presetScopeFor(database.db, owner, 'builtin:nothing-failed', flow, NOW),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes only the reader’s own preset', async () => {
    const saved = await saveSimulationPreset(database.db, owner, {
      id: testId('ssp'),
      name: 'Synthetic to delete',
      scope: {},
    });
    await expect(deleteOwnSimulationPreset(database.db, stranger, saved.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await deleteOwnSimulationPreset(database.db, owner, saved.id);
    await expect(deleteOwnSimulationPreset(database.db, owner, saved.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
