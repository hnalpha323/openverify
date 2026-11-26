/** C143.5 (P19): no workflow audit entry carries free text. Each action's metadata is strict. */
import { describe, expect, it } from 'vitest';
import { WORKFLOW_AUDIT_ACTIONS, workflowAudit } from './audit.js';

const WORKFLOW = 'wfl_01M5CK3190XEVBM5ZXA76E1JSN';

describe('workflowAudit (C143.5)', () => {
  it('refuses a member beyond its schema, for every action', () => {
    for (const action of WORKFLOW_AUDIT_ACTIONS) {
      expect(() => workflowAudit(action, WORKFLOW, { note: 'free text' } as never)).toThrow();
    }
  });

  it('names its resource by the action', () => {
    expect(workflowAudit('workflow.paused', WORKFLOW, { reason: 'operator' })).toEqual({
      action: 'workflow.paused',
      resourceType: 'workflow',
      resourceId: WORKFLOW,
      metadata: { reason: 'operator' },
    });
    expect(
      workflowAudit('workflow-version.updated', 'wfv_01M5CK3190XEVBM5ZXA76E1JSN', {
        'workflow-id': WORKFLOW,
        'lock-version': 2,
      }).resourceType,
    ).toBe('workflow-version');
  });
});
