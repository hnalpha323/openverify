/**
 * C251.2 (Workflow 11B, `quotas`): each queue's cap per environment, at most the install ceiling;
 * Phase 8's `workflow-in-flight-cap` reconciled as Stage 1a amendment 17 froze it.
 */
import {
  QUEUE_IN_FLIGHT_CAP,
  QUEUE_IN_FLIGHT_CAP_QUEUES,
  WORKFLOW_IN_FLIGHT_CAP,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  ADMITTED_QUEUES,
  clampQueueCaps,
  effectiveQueueCap,
  effectiveQueueCaps,
  isAdmittedQueue,
  queueCapRefusalDetail,
  queueCapRefusals,
  storedQueueCaps,
} from './caps.js';

const INSTALL = { ceiling: 50 } as const;

describe('the admitted queues (C251.1; Stage 1a amendment 16)', () => {
  it('are the fifteen of the setting and workflow-step, in that order', () => {
    expect(ADMITTED_QUEUES).toEqual([...QUEUE_IN_FLIGHT_CAP_QUEUES, 'workflow-step']);
    expect(ADMITTED_QUEUES).toHaveLength(16);
  });

  it.each([
    ['process-verification', true],
    ['report-run', true],
    ['connect-redeem', true],
    ['account-export', true],
    ['integrity-decode', true],
    ['workflow-step', true],
    // Stage 1a amendment 16: outside the caps, each with its reason.
    ['export', false],
    ['report-bulk', false],
    ['case-export', false],
    ['workflow-trigger', false],
    ['flow-signal-snapshot', false],
    ['webhook-delivery', false],
    ['retention', false],
  ])('%s is admitted: %s', (queue, admitted) => {
    expect(isAdmittedQueue(queue)).toBe(admitted);
  });
});

describe('storedQueueCaps: the stored map, read loosely', () => {
  it('keeps each capped queue with a cap in bounds', () => {
    expect(storedQueueCaps({ 'report-run': 5, 'process-verification': 1000 })).toEqual({
      'report-run': 5,
      'process-verification': 1000,
    });
  });

  it.each([
    ['not an object', 7],
    ['null', null],
    ['an array', [1, 2]],
    ['undefined', undefined],
  ])('reads %s as no caps', (_name, value) => {
    expect(storedQueueCaps(value)).toEqual({});
  });

  it('drops a queue that is not capped, a cap out of bounds and a cap that is not an integer', () => {
    expect(
      storedQueueCaps({
        'workflow-step': 3,
        export: 3,
        'report-run': 0,
        'list-screen': 1001,
        'graph-query': 2.5,
        'case-bulk': '4',
        'list-import': 4,
      }),
    ).toEqual({ 'list-import': 4 });
  });
});

describe('effectiveQueueCap: the cap in force (C251.2)', () => {
  it('is 50 for a queue the environment never set, under the default ceiling', () => {
    for (const queue of QUEUE_IN_FLIGHT_CAP_QUEUES) {
      expect(effectiveQueueCap(queue, {}, INSTALL)).toBe(QUEUE_IN_FLIGHT_CAP.default);
    }
  });

  it('takes the environment’s lower value', () => {
    expect(
      effectiveQueueCap('report-run', { 'queue-in-flight-caps': { 'report-run': 3 } }, INSTALL),
    ).toBe(3);
  });

  it('never exceeds the install ceiling, whatever is stored (review P15)', () => {
    const settings = { 'queue-in-flight-caps': { 'report-run': 900 } };
    expect(effectiveQueueCap('report-run', settings, { ceiling: 50 })).toBe(50);
    expect(effectiveQueueCap('report-run', settings, { ceiling: 1000 })).toBe(900);
  });

  it('takes the ceiling when it is below the default', () => {
    expect(effectiveQueueCap('graph-index', {}, { ceiling: 10 })).toBe(10);
  });

  it('raises the default only as far as the ceiling allows: an unset queue stays at 50', () => {
    expect(effectiveQueueCap('graph-index', {}, { ceiling: 1000 })).toBe(50);
  });

  it('reads a ceiling below 1 as 1, so a queue always has a slot', () => {
    expect(effectiveQueueCap('graph-index', {}, { ceiling: 0 })).toBe(1);
  });

  it('applies one queue’s value to that queue only', () => {
    const settings = { 'queue-in-flight-caps': { 'list-screen': 2 } };
    expect(effectiveQueueCap('list-screen', settings, INSTALL)).toBe(2);
    expect(effectiveQueueCap('list-import', settings, INSTALL)).toBe(50);
  });
});

describe('effectiveQueueCap for workflow-step (Stage 1a amendment 17)', () => {
  it('follows Phase 8’s order: the slot’s override, the setting, the install default', () => {
    const settings = { 'workflow-in-flight-cap': 30 };
    const install = { ceiling: 1000, workflowDefault: 70 };
    expect(effectiveQueueCap('workflow-step', settings, install, 12)).toBe(12);
    expect(effectiveQueueCap('workflow-step', settings, install)).toBe(30);
    expect(effectiveQueueCap('workflow-step', {}, install)).toBe(70);
    expect(effectiveQueueCap('workflow-step', {}, { ceiling: 1000 })).toBe(
      WORKFLOW_IN_FLIGHT_CAP.default,
    );
  });

  it('clamps each of them to the ceiling: a stored 10,000 still parses and is held at 50', () => {
    const install = { ceiling: 50, workflowDefault: 400 };
    expect(effectiveQueueCap('workflow-step', { 'workflow-in-flight-cap': 10_000 }, install)).toBe(
      50,
    );
    expect(effectiveQueueCap('workflow-step', {}, install)).toBe(50);
    expect(effectiveQueueCap('workflow-step', {}, install, 999)).toBe(50);
  });

  it('ignores a stored workflow cap that is not one', () => {
    expect(
      effectiveQueueCap('workflow-step', { 'workflow-in-flight-cap': 'x' }, { ceiling: 50 }),
    ).toBe(50);
  });

  it('ignores the queue map for workflow-step', () => {
    expect(
      effectiveQueueCap(
        'workflow-step',
        { 'queue-in-flight-caps': { 'workflow-step': 2 } },
        { ceiling: 50 },
      ),
    ).toBe(50);
  });
});

describe('effectiveQueueCaps', () => {
  it('answers every admitted queue', () => {
    const caps = effectiveQueueCaps(
      { 'queue-in-flight-caps': { 'case-bulk': 4 }, 'workflow-in-flight-cap': 9 },
      { ceiling: 20 },
    );
    expect(Object.keys(caps)).toEqual([...ADMITTED_QUEUES]);
    expect(caps['case-bulk']).toBe(4);
    expect(caps['workflow-step']).toBe(9);
    expect(caps['report-run']).toBe(20);
  });
});

describe('clampQueueCaps: the stored map as served', () => {
  it('clamps each value to the ceiling and keeps the rest', () => {
    expect(clampQueueCaps({ 'report-run': 70, 'list-screen': 3 }, 50)).toEqual({
      'report-run': 50,
      'list-screen': 3,
    });
    expect(clampQueueCaps({}, 50)).toEqual({});
  });
});

describe('queueCapRefusals: the write check (C251.2; C55.7’s generic 422)', () => {
  it('lets every value at or below the ceiling through', () => {
    expect(
      queueCapRefusals(
        {
          'queue-in-flight-caps': { 'report-run': 50, 'case-bulk': 1 },
          'workflow-in-flight-cap': 50,
        },
        50,
      ),
    ).toEqual([]);
    expect(queueCapRefusals({}, 50)).toEqual([]);
  });

  it('points at each queue above the ceiling, in the setting’s order, then the workflow cap', () => {
    expect(
      queueCapRefusals(
        {
          'queue-in-flight-caps': {
            'case-bulk': 51,
            'process-verification': 1000,
            'report-run': 2,
          },
          'workflow-in-flight-cap': 10_000,
        },
        50,
      ),
    ).toEqual([
      { pointer: '/queue-in-flight-caps/process-verification', detail: 'must be at most 50' },
      { pointer: '/queue-in-flight-caps/case-bulk', detail: 'must be at most 50' },
      { pointer: '/workflow-in-flight-cap', detail: 'must be at most 50' },
    ]);
  });

  it('allows what a raised ceiling allows', () => {
    expect(queueCapRefusals({ 'queue-in-flight-caps': { 'report-run': 900 } }, 1000)).toEqual([]);
  });

  it('names the ceiling in its detail', () => {
    expect(queueCapRefusalDetail(50)).toBe(
      "A queue's in-flight cap is at most this installation's ceiling, 50.",
    );
  });
});
