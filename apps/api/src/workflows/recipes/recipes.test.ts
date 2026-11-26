/** C112.6, C140.5 (V16): the recipe table, its routes, and an install as a disabled draft. */
import { checkDefinition, type DefinitionCheck } from '@openverify/workflow-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';
import { chain } from '../publish/testing.js';
import { WORKFLOW_RECIPES } from './rows.js';
import { createWorkflowRecipeTable } from './table.js';

let api: TestApi;
let admin: string;

beforeAll(async () => {
  api = await createTestApi();
  admin = api.newUserToken(api.environmentId);
});

afterAll(async () => {
  await api.close();
});

const call = (method: 'GET' | 'POST', url: string) =>
  api.app.inject({ method, url: `/api/v1${url}`, headers: bearer(admin) });

const KEY = 'rescreen-on-account-field-change';

const check = (definition: Parameters<typeof checkDefinition>[0]): DefinitionCheck =>
  checkDefinition(definition, { kind: 'workflow', mode: 'draft', registry: WORKFLOW_ACTIONS });

describe('the table', () => {
  it('holds every recipe as a definition the draft check takes', () => {
    expect(WORKFLOW_RECIPES.list().length).toBeGreaterThan(0);
    for (const recipe of WORKFLOW_RECIPES.list()) {
      expect(check(recipe.definition()).errors, recipe.key).toEqual([]);
    }
  });

  const recipe = {
    key: 'synthetic',
    name: 'Synthetic',
    description: 'A row of the table.',
    needsConfiguration: [],
    definition: () => chain([]),
  };

  it('re-screens each stale monitored report of the account, with nothing to name (K8-7)', () => {
    const recipe = WORKFLOW_RECIPES.get(KEY);
    const steps = recipe?.definition().steps ?? [];
    expect(steps.filter((step) => step.type === 'action')).toEqual([
      expect.objectContaining({
        'action-key': 'rescreen_account_reports',
        config: { 'account-id': '{{ trigger.id }}', 'timeout-seconds': 3_600 },
      }),
    ]);
    expect(recipe?.needsConfiguration).toEqual([]);
  });

  it('takes rows, so a later Workflow adds its own', () => {
    expect(createWorkflowRecipeTable([recipe]).get('synthetic')).toMatchObject({
      key: 'synthetic',
      triggerType: 'trigger-event',
    });
    expect(createWorkflowRecipeTable([recipe]).get('other')).toBeUndefined();
  });

  it('refuses a key twice, and a recipe with no trigger', () => {
    expect(() => createWorkflowRecipeTable([recipe, recipe])).toThrow('registered twice');
    expect(() =>
      createWorkflowRecipeTable([{ ...recipe, definition: () => chain([], { trigger: null }) }]),
    ).toThrow('no trigger');
  });
});

describe('the routes (C140.5)', () => {
  it('lists each recipe with its trigger and what it needs', async () => {
    const response = await call('GET', '/workflow-recipes');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      links: { next: null },
      data: [
        {
          type: 'workflow-recipe',
          id: KEY,
          attributes: {
            'trigger-type': 'trigger-event',
            'needs-configuration': [],
          },
        },
        {
          type: 'workflow-recipe',
          id: 'review-on-report-match',
          attributes: {
            'trigger-type': 'trigger-event',
            'needs-configuration': ['case-template-id', 'decision-basis', 'contest-route'],
          },
        },
      ],
    });
  });

  it('installs a disabled workflow with its draft, which publish refuses until it is filled', async () => {
    // K8-7: the re-screen recipe names nothing now, so the case recipe's placeholders are refused.
    const response = await call('POST', '/workflow-recipes/review-on-report-match/install');
    expect(response.statusCode, response.body).toBe(201);
    const { data } = response.json<{
      data: { id: string; attributes: { status: string; 'paused-reason': string } };
    }>();
    expect(data.attributes).toMatchObject({ status: 'paused', 'paused-reason': 'operator' });
    const draft = await call('GET', `/workflows/${data.id}/draft`);
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({
      data: { attributes: { 'trigger-type': 'trigger-event', status: 'draft' } },
    });
    const publish = await call('POST', `/workflows/${data.id}/publish`);
    expect(publish.statusCode).toBe(422);
    expect(publish.json()).toMatchObject({
      code: 'definition_invalid',
      errors: [{ code: 'reference_unknown' }],
    });
  });

  it('answers 404 for a key it does not hold', async () => {
    expect((await call('POST', '/workflow-recipes/nothing/install')).statusCode).toBe(404);
  });
});
