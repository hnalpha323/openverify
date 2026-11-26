/**
 * Workflow 9B Stage 1b, checkpoint (C): what `foundation-9b` builds in the database for the case
 * completions (C172.1-C172.5; contracts B34-B37), frozen for `api-cases-reports`:
 *
 * - `case_template_versions.layout` (an object, `null` for the default layout), `checklists` (an
 *   array of at most 10) and `preset_comments` (an array of at most 50), stored and changed through
 *   the version repository, `null`, `[]` and `[]` for every existing version;
 * - `case_checklist_states (environment_id, case_id, checklist_key, item_key)`: one row per item of a
 *   case, a checked item naming who checked it (a user or a workflow run) and when, an unchecked one
 *   neither; deleted with its case, never another environment's case (C172.2, C172.7);
 * - `case_history_kind_valid` over Phase 8's kinds and the checklist's (B34);
 * - `case_actions.placement`: `header`, `status-switcher` or `module:<module key>` (B34), and
 *   `case_actions.visible_when` (an object, `null` for no restriction; B37), stored and changed
 *   through the action repository.
 *
 * Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCaseAction, updateCaseAction } from './repositories/case-actions.js';
import {
  createCaseTemplateVersionRow,
  updateCaseTemplateVersionRow,
  type CaseTemplateVersionContent,
} from './repositories/case-templates.js';
import {
  createTestDatabase,
  createTestTenant,
  seedCase,
  seedCaseTemplate,
  seedWorkflow,
  testId,
  type TestDatabase,
} from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

/** The error's message, or `accepted`. */
const refused = async (text: string, params: unknown[] = []) =>
  query(text, params).then(
    () => 'accepted',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

async function tenant() {
  const { environment } = await createTestTenant(database.db);
  return environment.id;
}

/** A tenant with a published template and an open case on it. */
async function caseOnTemplate() {
  const environmentId = await tenant();
  const template = await seedCaseTemplate(database.db, environmentId);
  const created = await seedCase(database.db, environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: 1,
  });
  return { environmentId, template, caseId: created.id };
}

const LAYOUT = {
  columns: 2,
  modules: [
    { key: 'fields', column: 1, order: 0, collapsed: false },
    { key: 'timeline', column: 2, order: 0, collapsed: true },
  ],
};
const CHECKLISTS = [
  {
    key: 'identity',
    label: 'Identity checks',
    items: [{ key: 'id-reviewed', label: 'ID reviewed', 'required-for-statuses': ['approved'] }],
  },
];
const PRESET_COMMENTS = [
  { key: 'need-document', label: 'Ask for a document', text: 'Please upload a clearer document.' },
];

const CONTENT: CaseTemplateVersionContent = {
  fieldSchemas: [],
  statuses: [{ key: 'open', label: 'Open', category: 'initial' }],
  resolutions: ['Approved'],
  transitions: null,
  defaultQueueId: null,
  assignmentPolicyId: null,
  slaPolicyId: null,
  slaStartsOn: 'created',
  heldObjectTypes: ['inquiry'],
  attachmentPolicy: null,
  notifyOnCreate: [],
  layoutModules: null,
};

describe('case template versions: layout, checklists and preset comments (C172.1, C172.2, C172.4)', () => {
  it('hold none by default: layout null, no checklist and no preset comment', async () => {
    const { environmentId, template } = await caseOnTemplate();
    const { rows } = await query(
      `select layout, checklists, preset_comments from case_template_versions where id = $1`,
      [template.versionId],
    );
    expect(rows).toEqual([{ layout: null, checklists: [], preset_comments: [] }]);
    expect(environmentId).toMatch(/^env_/);
  });

  it('are stored on a new draft and changed on it through the version repository', async () => {
    const { environmentId, template } = await caseOnTemplate();
    const draft = await createCaseTemplateVersionRow(database.db, environmentId, {
      id: testId('ctmplv'),
      caseTemplateId: template.id,
      content: {
        ...CONTENT,
        layout: LAYOUT,
        checklists: CHECKLISTS,
        presetComments: PRESET_COMMENTS,
      },
    });
    expect(draft).toMatchObject({
      layout: LAYOUT,
      checklists: CHECKLISTS,
      presetComments: PRESET_COMMENTS,
    });

    const changed = await updateCaseTemplateVersionRow(database.db, environmentId, draft.id, {
      layout: null,
      checklists: [],
      presetComments: [...PRESET_COMMENTS, { key: 'closing', label: 'Close', text: 'Done.' }],
    });
    expect(changed).toMatchObject({
      layout: null,
      checklists: [],
      presetComments: [...PRESET_COMMENTS, { key: 'closing', label: 'Close', text: 'Done.' }],
    });
  });

  it('hold each to its JSON form and its count', async () => {
    const { template } = await caseOnTemplate();
    const update = (column: string, value: unknown) =>
      refused(`update case_template_versions set ${column} = $2::jsonb where id = $1`, [
        template.versionId,
        JSON.stringify(value),
      ]);

    expect(await update('layout', [])).toContain('case_template_versions_layout_object');
    expect(await update('checklists', {})).toContain('case_template_versions_checklists_array');
    expect(
      await update(
        'checklists',
        Array.from({ length: 11 }, () => CHECKLISTS[0]),
      ),
    ).toContain('case_template_versions_checklists_array');
    expect(await update('preset_comments', {})).toContain(
      'case_template_versions_preset_comments_array',
    );
    expect(
      await update(
        'preset_comments',
        Array.from({ length: 51 }, () => PRESET_COMMENTS[0]),
      ),
    ).toContain('case_template_versions_preset_comments_array');
    expect(
      await update(
        'checklists',
        Array.from({ length: 10 }, () => CHECKLISTS[0]),
      ),
    ).toBe('accepted');
  });
});

describe('case_checklist_states (C172.2, C172.7)', () => {
  const insert = `insert into case_checklist_states (environment_id, case_id, checklist_key, item_key,
      checked, checked_by_type, checked_by_id, checked_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8)`;

  it('holds a checked item naming who and when, and an unchecked one naming neither', async () => {
    const { environmentId, caseId } = await caseOnTemplate();
    const userId = testId('usr');
    const runId = testId('wfr');
    const at = '2026-11-06T10:00:00.000Z';
    await query(insert, [
      environmentId,
      caseId,
      'identity',
      'id-reviewed',
      true,
      'user',
      userId,
      at,
    ]);
    await query(insert, [
      environmentId,
      caseId,
      'identity',
      'address-reviewed',
      true,
      'workflow-run',
      runId,
      at,
    ]);
    await query(insert, [environmentId, caseId, 'identity', 'selfie', false, null, null, null]);

    const { rows } = await query<{
      item_key: string;
      checked: boolean;
      checked_by_type: string | null;
      checked_by_id: string | null;
      updated_at: Date;
    }>(
      `select item_key, checked, checked_by_type, checked_by_id, updated_at
         from case_checklist_states where case_id = $1 order by item_key`,
      [caseId],
    );
    expect(
      rows.map(({ item_key, checked, checked_by_type, checked_by_id }) => ({
        item_key,
        checked,
        checked_by_type,
        checked_by_id,
      })),
    ).toEqual([
      {
        item_key: 'address-reviewed',
        checked: true,
        checked_by_type: 'workflow-run',
        checked_by_id: runId,
      },
      { item_key: 'id-reviewed', checked: true, checked_by_type: 'user', checked_by_id: userId },
      { item_key: 'selfie', checked: false, checked_by_type: null, checked_by_id: null },
    ]);
    expect(rows.every((row) => row.updated_at instanceof Date)).toBe(true);
  });

  it('never checks an item without who and when, nor names them on an unchecked one', async () => {
    const { environmentId, caseId } = await caseOnTemplate();
    const at = '2026-11-06T10:00:00.000Z';
    const userId = testId('usr');
    const row = (overrides: unknown[]) => refused(insert, [environmentId, caseId, ...overrides]);

    expect(await row(['identity', 'a', true, null, null, null])).toContain(
      'case_checklist_states_checked_whole',
    );
    expect(await row(['identity', 'b', true, 'user', userId, null])).toContain(
      'case_checklist_states_checked_whole',
    );
    expect(await row(['identity', 'c', false, 'user', userId, at])).toContain(
      'case_checklist_states_checked_whole',
    );
    expect(await row(['identity', 'd', true, 'user', null, at])).toContain(
      'case_checklist_states_checked_by_is_whole',
    );
    expect(await row(['identity', 'e', true, 'api-key', testId('key'), at])).toContain(
      'case_checklist_states_checked_by_type_valid',
    );
    expect(await row(['identity', 'f', true, 'user', testId('wfr'), at])).toContain(
      'case_checklist_states_checked_by_id_format',
    );
    expect(await row(['Identity', 'g', true, 'user', userId, at])).toContain(
      'case_checklist_states_checklist_key_format',
    );
    expect(await row(['identity', 'h'.repeat(41), true, 'user', userId, at])).toContain(
      'case_checklist_states_item_key_format',
    );
  });

  it('holds one row per item of a case', async () => {
    const { environmentId, caseId } = await caseOnTemplate();
    await query(insert, [environmentId, caseId, 'identity', 'once', false, null, null, null]);
    expect(
      await refused(insert, [environmentId, caseId, 'identity', 'once', false, null, null, null]),
    ).toContain('case_checklist_states_pkey');
  });

  it('refuses another environment’s case, and goes with its case', async () => {
    const { environmentId, caseId } = await caseOnTemplate();
    const other = await tenant();
    expect(
      await refused(insert, [other, caseId, 'identity', 'elsewhere', false, null, null, null]),
    ).toContain('case_checklist_states_case_fk');

    await query(insert, [environmentId, caseId, 'identity', 'kept', false, null, null, null]);
    await query(`delete from cases where id = $1`, [caseId]);
    const { rows } = await query<{ count: number }>(
      `select count(*)::int as count from case_checklist_states where case_id = $1`,
      [caseId],
    );
    expect(rows).toEqual([{ count: 0 }]);
  });
});

describe('case history: the checklist kinds (C172.2; B34)', () => {
  it('takes checklist-item-checked and -unchecked, and still refuses a kind outside the lists', async () => {
    const { environmentId, caseId } = await caseOnTemplate();
    const insert = `insert into case_history (environment_id, case_id, kind, actor_type, actor_id, "to")
      values ($1, $2, $3, 'user', $4, $5::jsonb)`;
    const to = JSON.stringify({ 'checklist-key': 'identity', 'item-key': 'id-reviewed' });

    expect(
      await refused(insert, [environmentId, caseId, 'checklist-item-checked', testId('usr'), to]),
    ).toBe('accepted');
    expect(
      await refused(insert, [environmentId, caseId, 'checklist-item-unchecked', testId('usr'), to]),
    ).toBe('accepted');
    expect(
      await refused(insert, [environmentId, caseId, 'checklist-item-skipped', testId('usr'), to]),
    ).toContain('case_history_kind_valid');
  });
});

describe('case actions: placements and visibility (C172.5; B34, B37)', () => {
  async function actionTenant() {
    const environmentId = await tenant();
    const { id: workflowId } = await seedWorkflow(database.db, environmentId);
    const template = await seedCaseTemplate(database.db, environmentId);
    return { environmentId, workflowId, templateId: template.id };
  }

  const insert = `insert into case_actions (id, environment_id, workflow_id, label, placement)
    values ($1, $2, $3, 'Escalate', $4)`;

  it('places an action in the header, the status switcher or a layout module, and nowhere else', async () => {
    const { environmentId, workflowId } = await actionTenant();
    const place = (placement: string) =>
      refused(insert, [testId('cact'), environmentId, workflowId, placement]);

    for (const placement of ['header', 'status-switcher', 'module:summary', 'module:a-1']) {
      expect(await place(placement), placement).toBe('accepted');
    }
    for (const placement of [
      'footer',
      'module:',
      'module:Summary',
      'module:1st',
      `module:${'a'.repeat(64)}`,
      'Header',
    ]) {
      expect(await place(placement), placement).toContain('case_actions_placement_valid');
    }
  });

  it('restricts nothing by default, and holds a restriction as an object', async () => {
    const { environmentId, workflowId } = await actionTenant();
    const id = testId('cact');
    await query(insert, [id, environmentId, workflowId, 'header']);
    const { rows } = await query(`select visible_when from case_actions where id = $1`, [id]);
    expect(rows).toEqual([{ visible_when: null }]);

    expect(
      await refused(`update case_actions set visible_when = '[]'::jsonb where id = $1`, [id]),
    ).toContain('case_actions_visible_when_object');
    expect(
      await refused(
        `update case_actions set visible_when = '{"statuses":["open"],"role-ids":[]}'::jsonb where id = $1`,
        [id],
      ),
    ).toBe('accepted');
  });

  it('stores and changes the placement and the visibility through the action repository', async () => {
    const { environmentId, workflowId, templateId } = await actionTenant();
    const visibility = { statuses: ['open'], 'role-ids': [testId('role')] };
    const created = await createCaseAction(database.db, environmentId, {
      id: testId('cact'),
      workflowId,
      label: 'Escalate',
      placement: 'module:summary',
      visibleWhen: visibility,
      prefill: {},
      caseTemplateIds: [templateId],
    });
    expect(created).toMatchObject({ placement: 'module:summary', visibleWhen: visibility });

    const moved = await updateCaseAction(database.db, environmentId, created.id, {
      placement: 'status-switcher',
      visibleWhen: null,
    });
    expect(moved).toMatchObject({ placement: 'status-switcher', visibleWhen: null });
  });
});
