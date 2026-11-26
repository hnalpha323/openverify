/**
 * C156.4 (Workflow 9B, api-templates-carry): the simulation preset routes of the dashboard API. An
 * operator lists the built-in presets and their own, saves one (sealed at rest, labelled "synthetic
 * values only") and deletes their own; nobody reads another's, and a reader without `pii:view` gets
 * the scope masked (C174.5). Every value is synthetic.
 */
import {
  simulationPresetDocumentSchema,
  simulationPresetListDocumentSchema,
} from '@openverify/contracts';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
} from './dashboard.test-support.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function setup() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const signedIn = async (roles: ('admin' | 'developer')[]) => {
    const operator = await api.operator(organization, { roles });
    return api.signIn(operator.email);
  };
  return { api, admin: await signedIn(['admin']), other: await signedIn(['admin']), signedIn };
}

const SCOPE = {
  verifications: { id_card: { status: 'passed', extractions: { 'age-years': 16 } } },
};
const body = (name: string, scope: unknown = SCOPE) => ({
  data: { type: 'simulation-preset', attributes: { name, scope } },
});

describe('the simulation preset routes (C156.4)', () => {
  it('lists the built-in presets, then saves, lists and deletes an operator’s own', async () => {
    const { api, admin } = await setup();
    const empty = simulationPresetListDocumentSchema.parse(
      expectJson(await api.call('GET', '/simulation-presets', { token: admin }), 200),
    );
    expect(empty.data.length).toBeGreaterThan(0);
    expect(empty.data.every((preset) => preset.attributes['built-in'])).toBe(true);
    expect(empty.links.next).toBeNull();

    const saved = simulationPresetDocumentSchema.parse(
      expectJson(
        await api.call('POST', '/simulation-presets', { token: admin, payload: body('A minor') }),
        201,
      ),
    );
    expect(saved.data).toMatchObject({
      type: 'simulation-preset',
      attributes: {
        name: 'A minor',
        label: 'synthetic values only',
        'built-in': false,
        scope: SCOPE,
      },
    });
    expect(saved.data.id).toMatch(/^ssp_/);
    const listed = simulationPresetListDocumentSchema.parse(
      expectJson(await api.call('GET', '/simulation-presets', { token: admin }), 200),
    );
    expect(listed.data.at(-1)?.id).toBe(saved.data.id);

    const removed = await api.call('DELETE', `/simulation-presets/${saved.data.id}`, {
      token: admin,
    });
    expect(removed.statusCode).toBe(204);
    const again = await api.call('DELETE', `/simulation-presets/${saved.data.id}`, {
      token: admin,
    });
    expect(again.statusCode).toBe(404);
  });

  it("never serves or deletes another operator's preset", async () => {
    const { api, admin, other } = await setup();
    const saved = expectJson<{ data: { id: string } }>(
      await api.call('POST', '/simulation-presets', { token: admin, payload: body('Mine') }),
      201,
    );
    const theirs = expectJson<{ data: { id: string }[] }>(
      await api.call('GET', '/simulation-presets', { token: other }),
      200,
    );
    expect(theirs.data.map(({ id }) => id)).not.toContain(saved.data.id);
    const refused = await api.call('DELETE', `/simulation-presets/${saved.data.id}`, {
      token: other,
    });
    expect(refused.statusCode).toBe(404);
  });

  it('masks the scope to an operator without pii:view', async () => {
    const { api, signedIn } = await setup();
    const developer = await signedIn(['developer']);
    const saved = expectJson<{ data: { id: string; attributes: { scope: unknown } } }>(
      await api.call('POST', '/simulation-presets', { token: developer, payload: body('Masked') }),
      201,
    );
    expect(saved.data.attributes.scope).toBeNull();
    const listed = expectJson<{ data: { id: string; attributes: { scope: unknown } }[] }>(
      await api.call('GET', '/simulation-presets', { token: developer }),
      200,
    );
    expect(listed.data.find(({ id }) => id === saved.data.id)?.attributes.scope).toBeNull();
  });

  it('refuses a scope outside the simulated scope schema with 400', async () => {
    const { api, admin } = await setup();
    const response = await api.call('POST', '/simulation-presets', {
      token: admin,
      payload: body('Bad', { unknown: true }),
    });
    expect(response.statusCode).toBe(400);
  });
});
