/** C143.5 (P19): no queue, policy, calendar or assignment audit entry carries free text. */
import { describe, expect, it } from 'vitest';
import { QUEUE_AUDIT_ACTIONS, queueAudit } from './audit.js';

const QUEUE = 'cqueue_01M5CK3190XEVBM5ZXA76E1JSN';

describe('queueAudit (C143.5)', () => {
  it('refuses a member beyond its schema, for every action', () => {
    for (const action of QUEUE_AUDIT_ACTIONS) {
      expect(() => queueAudit(action, QUEUE, { note: 'free text' } as never)).toThrow();
    }
  });

  it('refuses a name where a member name belongs, and names its resource by the action', () => {
    expect(() =>
      queueAudit('case-queue.updated', QUEUE, { attributes: ['Synthetic queue name'] }),
    ).toThrow();
    expect(queueAudit('case-queue.archived', QUEUE, { 'returned-case-count': 2 })).toEqual({
      action: 'case-queue.archived',
      resourceType: 'case-queue',
      resourceId: QUEUE,
      metadata: { 'returned-case-count': 2 },
    });
    expect(
      queueAudit('case.assigned', 'case_01M5CK3190XEVBM5ZXA76E1JSN', {
        strategy: 'pull',
        'assignee-id': 'usr_01M5CK3190XEVBM5ZXA76E1JSN',
      }).resourceType,
    ).toBe('case');
  });
});
