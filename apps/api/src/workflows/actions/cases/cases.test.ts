/**
 * C140.2, C140.7, C128.2, C121.6, C128.7 (Workflow 8B, `api-case-workflows`): the case side of 8A's
 * tables. A case is a trigger object read unmasked; `current_case` is typed for a case's workflows
 * and filled with the live case when a run starts; a `case.resolved` wait's case holds the decision's
 * subject from its held objects; the generic actions read and fetch a case; a case template is a
 * reference, and a contest route may name one. Every value is synthetic.
 */
import { WORKFLOW_ACTION_ERROR_TYPES } from '@openverify/workflow-engine/actions';
import { checkDefinition, type JsonRecord } from '@openverify/workflow-engine';
import {
  createTestInquiry,
  seedCase,
  seedCaseTemplate,
  seedReport,
  seedReportTemplate,
  testId,
} from '@openverify/db/testing';
import { events, getCaseRow } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WORKFLOW_ACTIONS } from '../../definitions/registry.js';
import type { ActionContext } from '../../engine/action-port.js';
import type { ObjectRow } from '../objects/table.js';
import type { StagedEvent } from '../../../events/index.js';
import { piiMaskFor, UNMASKED } from '../../../auth/pii.js';
import { action, chain, drain, output, outputsOf, runOf, start } from '../../engine/testing.js';
import { createActionHarness, type ActionHarness } from '../testing.js';
import { CASE_GRANT } from './testing.js';
import { caseTemplateContestRouteIssues } from './contest-route.js';
import { currentCaseScopeOf, currentCaseValueOf } from './current-case.js';
import { caseHoldsSubject } from './holds.js';
import { CASE_OBJECT_ROWS } from './object-rows.js';
import { CASE_RECIPE_ROWS, REVIEW_ON_REPORT_MATCH } from './recipes.js';
import { CASE_KIND_OF_PREFIX, CASE_REFERENCE_MEMBERS } from './references.js';
import { caseObjectIdFits, caseTriggerDocumentOf } from './trigger.js';

let harness: ActionHarness;

beforeAll(async () => {
  harness = await createActionHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

const query = (text: string, params: unknown[] = []) => harness.database.client.query(text, params);

let keys = 0;

async function newCase(fields: Record<string, unknown> = {}) {
  keys += 1;
  const template = await seedCaseTemplate(harness.db, harness.environmentId, {
    key: `CW${String(keys)}`,
  });
  const created = await seedCase(harness.db, harness.environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: 1,
    fields,
  });
  return { caseId: created.id, name: created.name, templateId: template.id };
}

const hold = (table: string, column: string, caseId: string, id: string) =>
  query(
    `insert into ${table} (environment_id, case_id, ${column}, attached_by_type, attached_by_id)
     values ($1, $2, $3, 'user', $4)`,
    [harness.environmentId, caseId, id, testId('usr')],
  );

const FIELDS = { reference: { type: 'string', value: 'synthetic-reference' } };

const definitionWith = (trigger: unknown) => chain([], { trigger });

describe('a case as a trigger object (C118.4, C118.5, C140.2)', () => {
  it('names a case by its id alone', () => {
    expect(caseObjectIdFits(testId('case'))).toBe(true);
    expect(caseObjectIdFits(testId('inq'))).toBe(false);
    expect(caseObjectIdFits('case_short')).toBe(false);
  });

  it('reads a case as the server API serves it, unmasked, with what it holds', async () => {
    const { caseId, name, templateId } = await newCase(FIELDS);
    const { inquiry } = await createTestInquiry(harness.db, harness.environmentId);
    await hold('case_inquiries', 'inquiry_id', caseId, inquiry.id);

    const document = await caseTriggerDocumentOf(harness.db, harness.environmentId, caseId);
    expect(document?.data).toMatchObject({
      type: 'case',
      id: caseId,
      attributes: {
        name,
        status: 'open',
        'status-category': 'initial',
        fields: FIELDS,
        'held-object-counts': { inquiries: 1, accounts: 0 },
      },
      relationships: {
        'case-template': { data: { type: 'case-template', id: templateId } },
        inquiries: { data: [{ type: 'inquiry', id: inquiry.id }] },
      },
    });
    expect(await caseTriggerDocumentOf(harness.db, harness.environmentId, testId('case'))).toBe(
      null,
    );
  });
});

describe('current_case (C140.2)', () => {
  it('is typed for a case’s workflows, and for nothing else', () => {
    const typed = currentCaseScopeOf(definitionWith({ type: 'trigger-case', config: {} }));
    expect(typed?.kind).toBe('object');
    expect(typed?.kind === 'object' && Object.keys(typed.members)).toEqual(
      expect.arrayContaining(['status', 'fields', 'resolution', 'name']),
    );
    const onEvent = definitionWith({
      type: 'trigger-event',
      config: { events: ['case.resolved', 'case.created'] },
    });
    expect(currentCaseScopeOf(onEvent)).toEqual(typed);
    const recurring = definitionWith({
      type: 'trigger-recurring',
      config: { 'every-minutes': 60, 'time-zone': 'UTC', 'object-type': 'case' },
    });
    expect(currentCaseScopeOf(recurring)).toEqual(typed);
    expect(
      currentCaseScopeOf(
        definitionWith({ type: 'trigger-event', config: { events: ['inquiry.completed'] } }),
      ),
    ).toBeUndefined();
    expect(
      currentCaseScopeOf(
        definitionWith({
          type: 'trigger-event',
          config: { events: ['case.resolved', 'inquiry.completed'] },
        }),
      ),
    ).toBeUndefined();
    expect(currentCaseScopeOf(definitionWith({ type: 'trigger-api', config: {} }))).toBeUndefined();
  });

  it('lets publish read current_case on a case’s workflow, and refuses it elsewhere', () => {
    const reads = (trigger: unknown) => {
      const definition = chain([], {
        trigger,
        steps: [output({ status: '{{ current_case.status }}' })],
        outputs: [{ name: 'status', pii: false }],
      });
      const currentCase = currentCaseScopeOf(definition);
      return checkDefinition(definition, {
        kind: 'workflow',
        mode: 'draft',
        registry: WORKFLOW_ACTIONS,
        ...(currentCase === undefined ? {} : { currentCase }),
      }).errors.map(({ code }) => code);
    };
    expect(reads({ type: 'trigger-case', config: {} })).toEqual([]);
    expect(reads({ type: 'trigger-api', config: {} })).toContain('current_case_unavailable');
  });

  it('holds the live case when a run starts, fields and all', async () => {
    const { caseId, name } = await newCase(FIELDS);
    await query(`update cases set tags = '{escalated}' where id = $1`, [caseId]);
    const id = await start(
      harness,
      chain([], {
        trigger: { type: 'trigger-case', config: {} },
        steps: [
          output({
            name: '{{ current_case.name }}',
            reference: '{{ current_case.fields.reference.value }}',
          }),
        ],
        outputs: [
          { name: 'name', pii: false },
          { name: 'reference', pii: true },
        ],
      }),
      { triggerType: 'trigger-case', trigger: { type: 'case', id: caseId }, subjectIds: [caseId] },
    );
    await drain(harness);
    expect((await runOf(harness, id)).status).toBe('completed');
    expect(await outputsOf(harness, id)).toEqual({ name, reference: 'synthetic-reference' });
  });

  it('reads a comment’s case, and holds nothing for a run that is not about a case', async () => {
    const { caseId } = await newCase(FIELDS);
    const run = async (trigger: JsonRecord) => {
      const id = await start(harness, chain([]), { trigger });
      return runOf(harness, id);
    };
    const onComment = await currentCaseValueOf(
      harness.db,
      await run({ type: 'case-comment', id: testId('cscm'), case: { type: 'case', id: caseId } }),
    );
    expect(onComment).toMatchObject({ id: caseId, type: 'case', status: 'open' });
    expect(
      await currentCaseValueOf(harness.db, await run({ type: 'inquiry', id: testId('inq') })),
    ).toBeUndefined();
    expect(
      await currentCaseValueOf(harness.db, await run({ type: 'case', id: testId('case') })),
    ).toBeNull();
  });
});

describe('the case a wait read holds the decision’s subject (C128.2)', () => {
  async function resolvedEvent(caseId: string, name = 'case.resolved') {
    const id = testId('evt');
    await harness.db.insert(events).values({
      id,
      environmentId: harness.environmentId,
      name,
      payload: { data: { type: 'case', id: caseId } } as never,
      objectId: caseId,
      objectType: 'case',
    });
    return id;
  }

  it('answers from the held objects: the inquiry itself, or a report of it', async () => {
    const { environmentId } = harness;
    const { inquiry } = await createTestInquiry(harness.db, environmentId);
    const other = await createTestInquiry(harness.db, environmentId);
    const holding = await newCase();
    await hold('case_inquiries', 'inquiry_id', holding.caseId, inquiry.id);
    const template = await seedReportTemplate(harness.db, environmentId);
    const reportId = await seedReport(harness.db, environmentId, {
      templateId: template.templateId,
      versionId: template.versionId,
      inquiryId: other.inquiry.id,
    });
    const reporting = await newCase();
    await hold('case_reports', 'report_id', reporting.caseId, reportId);
    const empty = await newCase();

    const holds = async (caseId: string, subjectId: string, name?: string) =>
      caseHoldsSubject(harness.db, {
        environmentId,
        eventId: await resolvedEvent(caseId, name),
        subjectId,
      });
    expect(await holds(holding.caseId, inquiry.id)).toBe(true);
    expect(await holds(reporting.caseId, other.inquiry.id)).toBe(true);
    expect(await holds(reporting.caseId, reportId)).toBe(true);
    expect(await holds(empty.caseId, inquiry.id)).toBe(false);
    expect(await holds(holding.caseId, other.inquiry.id)).toBe(false);
    expect(await holds(holding.caseId, inquiry.id, 'inquiry.approved')).toBe(false);
    expect(
      await caseHoldsSubject(harness.db, {
        environmentId,
        eventId: testId('evt'),
        subjectId: inquiry.id,
      }),
    ).toBe(false);
  });
});

describe('the generic actions on a case (C122.1, C140.3)', () => {
  const row = CASE_OBJECT_ROWS.case;
  const context = () =>
    ({
      environmentId: harness.environmentId,
      services: harness.services,
      acting: {
        ctx: { environmentId: harness.environmentId, organizationId: harness.organizationId },
        actor: { type: 'workflow-run', id: testId('wfr') },
        mask: UNMASKED,
      },
      now: new Date(),
    }) as unknown as ActionContext;

  it('reads a case’s tags and whether it was redacted', async () => {
    const { caseId } = await newCase(FIELDS);
    await query(`update cases set tags = '{escalated}' where id = $1`, [caseId]);
    expect(await row?.read(harness.db, context(), caseId)).toEqual({
      tags: ['escalated'],
      redacted: false,
    });
    expect(await row?.read(harness.db, context(), testId('case'))).toBeNull();
  });

  it('fetches a case under the run’s mask', async () => {
    const { caseId } = await newCase(FIELDS);
    const masked = {
      ...context(),
      acting: {
        ...context().acting,
        mask: piiMaskFor({ kind: 'api-key', piiMasked: true, permissions: new Set() } as never),
      },
    } as unknown as ActionContext;
    expect(await row?.fetch(masked, caseId)).toMatchObject({
      id: caseId,
      type: 'case',
      fields: { reference: { type: 'string', value: null } },
    });
  });

  it('fetches the case’s flattened view, its SLA as the case routes serve it', async () => {
    const { caseId } = await newCase(FIELDS);
    expect(await row?.fetch(context(), caseId)).toMatchObject({
      'sla-state': 'none',
      'sla-expires-at': null,
      status: 'open',
    });
  });

  const tagOf = (...args: Parameters<NonNullable<ObjectRow['tag']>>) => {
    if (row?.tag === undefined) {
      throw new Error('the case row does not tag');
    }
    return row.tag(...args);
  };
  const updateOf = (...args: Parameters<NonNullable<ObjectRow['update']>>) => {
    if (row?.update === undefined) {
      throw new Error('the case row does not update');
    }
    return row.update(...args);
  };
  const namesOf = async (staged: readonly StagedEvent[]) =>
    (
      await query('select name from events where id = any($1)', [
        staged.map(({ eventId }) => eventId),
      ])
    ).rows.map((event) => (event as { name: string }).name);

  it('tags a case through the case service, with its history and event', async () => {
    const { caseId } = await newCase();
    const staged: StagedEvent[] = [];
    await harness.db.transaction((tx) =>
      tagOf(tx, context(), caseId, { kind: 'add', tag: 'Escalated' }, staged),
    );
    expect(await namesOf(staged)).toEqual(['case.updated-tags']);
    await harness.db.transaction((tx) =>
      tagOf(tx, context(), caseId, { kind: 'set', tags: ['urgent'] }, []),
    );
    await harness.db.transaction((tx) =>
      tagOf(tx, context(), caseId, { kind: 'remove', tag: 'urgent' }, []),
    );
    const history = await query(
      'select kind, actor_type from case_history where case_id = $1 order by id',
      [caseId],
    );
    expect(history.rows).toEqual([
      { kind: 'tags-changed', actor_type: 'workflow-run' },
      { kind: 'tags-changed', actor_type: 'workflow-run' },
      { kind: 'tags-changed', actor_type: 'workflow-run' },
    ]);
    expect((await row?.read(harness.db, context(), caseId))?.tags).toEqual([]);
  });

  it('writes a case’s fields and its queue through the case services', async () => {
    const { caseId, templateId } = await newCase(FIELDS);
    await query(
      `update case_template_versions set field_schemas = $1::jsonb
        where case_template_id = $2`,
      [JSON.stringify([{ key: 'reference', label: 'Reference', type: 'string' }]), templateId],
    );
    const staged: StagedEvent[] = [];
    await harness.db.transaction((tx) =>
      updateOf(tx, context(), caseId, { fields: { reference: 'synthetic-other' } }, staged),
    );
    expect(await namesOf(staged)).toEqual(['case.updated-fields']);
    const fetched = (await row?.fetch(context(), caseId)) as { fields: unknown };
    expect(fetched.fields).toEqual({
      reference: { type: 'string', value: 'synthetic-other' },
    });
    await expect(
      harness.db.transaction((tx) =>
        updateOf(tx, context(), caseId, { fields: { unknown: 1 } }, []),
      ),
    ).rejects.toMatchObject({ code: 'action_input_invalid' });
    await expect(
      harness.db.transaction((tx) =>
        updateOf(tx, context(), caseId, { 'case-queue-id': testId('cqueue') }, []),
      ),
    ).rejects.toMatchObject({ code: 'object_not_found' });
    await harness.db.transaction((tx) =>
      updateOf(tx, context(), caseId, { 'case-queue-id': null }, []),
    );
    expect(WORKFLOW_ACTION_ERROR_TYPES.action_input_invalid).toBe('invalid-input-error');
  });
});

describe('a case template in a definition (C121.6, C128.7)', () => {
  it('is a reference by its prefix and its member, as a queue and a policy are', () => {
    expect(CASE_KIND_OF_PREFIX).toEqual({
      ctmpl: 'case-template',
      cqueue: 'case-queue',
      cap: 'case-assignment-policy',
    });
    expect(CASE_REFERENCE_MEMBERS).toEqual([
      'case-template-id',
      'case-queue-id',
      'assignment-policy-id',
    ]);
  });

  it('may stand in a contest route, now that a review request opens its case', () => {
    expect(
      caseTemplateContestRouteIssues('/steps/0/config/contest-route', testId('ctmpl')),
    ).toEqual([]);
  });
});

describe('the recipes with a case (C140.5)', () => {
  it('registers "Review on report match", whose draft the check takes now that a case is typed', () => {
    expect(CASE_RECIPE_ROWS).toEqual([REVIEW_ON_REPORT_MATCH]);
    const definition = REVIEW_ON_REPORT_MATCH.definition();
    const check = checkDefinition(definition, {
      kind: 'workflow',
      mode: 'draft',
      registry: WORKFLOW_ACTIONS,
    });
    // The case's resolution is a plain member of the case view, so its literal comparison stands.
    expect(check.errors).toEqual([]);
    expect(REVIEW_ON_REPORT_MATCH.needsConfiguration).toEqual([
      'case-template-id',
      'decision-basis',
      'contest-route',
    ]);
  });

  it('screens the completion reports that can match, waits for the case, and decides from it', () => {
    const definition = REVIEW_ON_REPORT_MATCH.definition();
    expect(definition.trigger).toMatchObject({ type: 'trigger-event' });
    const events =
      definition.trigger?.type === 'trigger-event' ? definition.trigger.config.events : [];
    expect(events).toEqual(
      expect.arrayContaining(['report/watchlist.matched', 'report/watchlist.errored']),
    );
    const keys = definition.steps.flatMap((step) =>
      step.type === 'action' ? [step['action-key']] : [step.type],
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'mark_inquiry_for_review',
        'create_case',
        'wait',
        'fetch_object',
        'conditional',
        'approve_inquiry',
        'decline_inquiry',
      ]),
    );
    const create = definition.steps.find(
      (step) => step.type === 'action' && step['action-key'] === 'create_case',
    );
    expect(create?.type === 'action' && create.config['object-ids']).toEqual([
      '{{ trigger.inquiry.id }}',
      '{{ trigger.id }}',
    ]);
    const decline = definition.steps.find(
      (step) => step.type === 'action' && step['action-key'] === 'decline_inquiry',
    );
    expect(decline?.type === 'action' && decline.config['decision-basis']).toBeUndefined();
    expect(decline?.type === 'action' && decline.config['contest-route']).toBeUndefined();
  });
});

describe('update_object on a case reads what the case holds (Workflow 8C review K8-18)', () => {
  it.each([
    ['append', '-more', 'synthetic-reference-more'],
    ['set', 'synthetic-other', 'synthetic-other'],
  ])('%s starts from the stored field', async (operator, value, expected) => {
    const { caseId, templateId } = await newCase(FIELDS);
    await query(
      `update case_template_versions set field_schemas = $1::jsonb
        where case_template_id = $2`,
      [JSON.stringify([{ key: 'reference', label: 'Reference', type: 'string' }]), templateId],
    );
    const run = await harness.run(
      chain([
        action('step', 'update_object', {
          'object-type': 'case',
          'object-id': caseId,
          field: 'fields.reference',
          operator,
          value,
        }),
      ]),
      { grant: CASE_GRANT },
    );
    expect(run).toMatchObject({ status: 'completed', errorCode: null });
    const stored = await getCaseRow(harness.db, harness.environmentId, caseId);
    expect(stored?.fields).toEqual({ reference: { type: 'string', value: expected } });
  });
});
