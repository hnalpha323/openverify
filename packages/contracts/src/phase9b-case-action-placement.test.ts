/**
 * Workflow 9B Stage 1b, checkpoint (C) (contracts B34, B37): the case action's `placement` moves to
 * `caseActionPlacementInputSchema` with `case_actions_placement_valid` in migration 0031, on the
 * resource, the available action and both bodies, and `visible-when` joins the bodies and is served
 * from the record. Every value is synthetic.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCaseActionResource,
  caseActionResourceSchema,
  caseAvailableActionResourceSchema,
  createCaseActionBodySchema,
  updateCaseActionBodySchema,
} from './case-actions.js';

const RECORD = {
  id: 'cact_00000000000000000000000001',
  workflowId: 'wfl_00000000000000000000000001',
  caseTemplateIds: ['ctmpl_00000000000000000000000001'],
  label: 'Escalate',
  status: 'active' as const,
  prefill: {},
  createdAt: new Date('2026-11-06T10:00:00Z'),
  updatedAt: new Date('2026-11-06T10:00:00Z'),
};

const VISIBLE_WHEN = { statuses: ['open'], 'role-ids': ['role_00000000000000000000000001'] };

describe('case action placements (C172.5; B34)', () => {
  it('serves the header, the status switcher and a layout module, and nothing else', () => {
    for (const placement of ['header', 'status-switcher', 'module:timeline']) {
      expect(buildCaseActionResource({ ...RECORD, placement }).attributes.placement).toBe(
        placement,
      );
    }
    expect(() => buildCaseActionResource({ ...RECORD, placement: 'footer' })).toThrow();
    expect(
      caseAvailableActionResourceSchema.safeParse({
        type: 'case-action',
        id: RECORD.id,
        attributes: { label: 'Escalate', placement: 'module:timeline', form: [] },
        relationships: { workflow: { data: { type: 'workflow', id: RECORD.workflowId } } },
      }).success,
    ).toBe(true);
  });

  it('serves visible-when from the record, null for no restriction, and leaves it out when the record has none', () => {
    expect(
      buildCaseActionResource({ ...RECORD, placement: 'header', visibleWhen: VISIBLE_WHEN })
        .attributes['visible-when'],
    ).toEqual(VISIBLE_WHEN);
    expect(
      buildCaseActionResource({ ...RECORD, placement: 'header', visibleWhen: null }).attributes[
        'visible-when'
      ],
    ).toBeNull();
    expect(
      'visible-when' in buildCaseActionResource({ ...RECORD, placement: 'header' }).attributes,
    ).toBe(false);
    expect(
      caseActionResourceSchema.safeParse(
        buildCaseActionResource({ ...RECORD, placement: 'header' }),
      ).success,
    ).toBe(true);
  });

  it('takes a placement and visible-when on create and on change', () => {
    const create = (attributes: Record<string, unknown>) =>
      createCaseActionBodySchema.safeParse({
        data: {
          type: 'case-action',
          attributes: {
            'workflow-id': RECORD.workflowId,
            'case-template-ids': RECORD.caseTemplateIds,
            label: 'Escalate',
            ...attributes,
          },
        },
      }).success;
    const change = (attributes: Record<string, unknown>) =>
      updateCaseActionBodySchema.safeParse({ data: { type: 'case-action', attributes } }).success;

    expect([
      create({ placement: 'module:timeline', 'visible-when': VISIBLE_WHEN }),
      create({ placement: 'status-switcher', 'visible-when': null }),
      change({ placement: 'module:timeline' }),
      change({ 'visible-when': VISIBLE_WHEN }),
      change({ 'visible-when': null }),
    ]).toEqual([true, true, true, true, true]);
    expect([
      create({ placement: 'module:Timeline' }),
      create({ 'visible-when': { statuses: [] } }),
      change({ placement: 'footer' }),
    ]).toEqual([false, false, false]);
  });
});
