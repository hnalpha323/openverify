/** C118.1, C118.4, C119.3: what a published version writes to the indexes `stage()` reads. */
import { REPORT_EVENT_NAMES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { scheduleOf, triggerIndexRows, waitEventNames } from './index-rows.js';
import { action, chain, INQUIRY } from './testing.js';

const VERSION = 'wfv_01M5CK3190XEVBM5ZXA76E1JSN';
const DEPLOYMENT = 'wfd_01M5CK3190XEVBM5ZXA76E1JSN';
const NOW = new Date('2026-10-20T12:00:30.000Z');

const wait = (id: string, events: readonly string[]) => ({
  id,
  type: 'wait',
  name: id,
  mode: 'events',
  subject: 'trigger.id',
  events,
  'timeout-seconds': 60,
  'on-timeout': 'continue',
});

describe('triggerIndexRows (C118.1)', () => {
  it('writes one row per event, naming the version, with the criteria as its filter', () => {
    const criteria = { '===': [{ var: 'trigger.status' }, 'completed'] };
    const definition = chain([], {
      trigger: {
        type: 'trigger-event',
        config: { events: ['inquiry.completed', 'inquiry.failed'], criteria, 'on-null': 'skip' },
      },
    });
    expect(triggerIndexRows(definition, { versionId: VERSION })).toEqual([
      {
        kind: 'trigger-event',
        eventName: 'inquiry.completed',
        workflowVersionId: VERSION,
        filter: { criteria, 'on-null': 'skip' },
      },
      {
        kind: 'trigger-event',
        eventName: 'inquiry.failed',
        workflowVersionId: VERSION,
        filter: { criteria, 'on-null': 'skip' },
      },
    ]);
  });

  it('writes a trigger’s subject filter beside the criteria, as the worker reads it (K8-10)', () => {
    const filter = { 'inquiry-template-ids': ['itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6'] };
    const definition = chain([], {
      trigger: {
        type: 'trigger-event',
        config: { events: ['inquiry.completed'], filter, 'on-null': 'skip' },
      },
    });
    expect(triggerIndexRows(definition, { versionId: VERSION })).toEqual([
      {
        kind: 'trigger-event',
        eventName: 'inquiry.completed',
        workflowVersionId: VERSION,
        filter: { 'on-null': 'skip', ...filter },
      },
    ]);
  });

  it('names a rollout by its deployment', () => {
    expect(triggerIndexRows(chain([]), { deploymentId: DEPLOYMENT })).toEqual([
      {
        kind: 'trigger-event',
        eventName: 'inquiry.completed',
        workflowDeploymentId: DEPLOYMENT,
        filter: null,
      },
    ]);
  });

  it('indexes a verification trigger as its own kind, with its filter (C118.6)', () => {
    const definition = chain([], {
      trigger: {
        type: 'trigger-verification',
        config: {
          events: ['verification.passed'],
          'verification-types': ['verification/government-id'],
        },
      },
    });
    expect(triggerIndexRows(definition, { versionId: VERSION })).toEqual([
      {
        kind: 'trigger-verification',
        eventName: 'verification.passed',
        workflowVersionId: VERSION,
        filter: { 'verification-types': ['verification/government-id'] },
      },
    ]);
  });

  it('writes one row with no event for what no event starts', () => {
    const definition = chain([], { trigger: { type: 'trigger-api', config: {} } });
    expect(triggerIndexRows(definition, { versionId: VERSION })).toEqual([
      { kind: 'trigger-api', eventName: null, workflowVersionId: VERSION, filter: null },
    ]);
  });

  it('writes nothing for a module, which has no trigger', () => {
    expect(triggerIndexRows(chain([], { trigger: null }), { versionId: VERSION })).toEqual([]);
  });
});

describe('waitEventNames (C119.3)', () => {
  it('holds each event a wait names, once', () => {
    const definition = chain([
      wait('one', ['inquiry.approved', 'inquiry.declined']),
      wait('two', ['inquiry.approved']),
    ]);
    expect(waitEventNames(definition)).toEqual(['inquiry.approved', 'inquiry.declined']);
  });

  it('holds what a step that waits resolves on (C127.2, C127.3, C127.5)', () => {
    const report = action('report', 'run_report', {
      'report-template-id': 'rptp_01M5CK3190XEVBM5ZXA76E1JSN',
      'inquiry-id': INQUIRY,
    });
    const query = action('query', 'run_graph_query', {
      'graph-query-template-id': 'grqt_01M5CK3190XEVBM5ZXA76E1JSN',
      'account-id': 'acc',
      mode: 'synchronous',
    });
    const names = waitEventNames(chain([report, query]));
    expect(names).toEqual(
      expect.arrayContaining([
        'report/watchlist.ready',
        'report/watchlist.errored',
        'graph-query.completed',
        'graph-query.errored',
        'graph-query.timed-out',
        'graph-query.cancelled',
      ]),
    );
    expect(names.every((name) => !name.startsWith('inquiry.'))).toBe(true);
  });

  it('holds every report type’s terminal events for rescreen_account_reports (K8-7, a request of api-carry-engine)', () => {
    const rescreen = action('rescreen', 'rescreen_account_reports', { 'account-id': INQUIRY });
    const terminal = REPORT_EVENT_NAMES.filter(
      (name) => name.endsWith('.ready') || name.endsWith('.errored'),
    );

    expect(terminal.length).toBeGreaterThan(0);
    expect(waitEventNames(chain([rescreen])).sort()).toEqual([...terminal].sort());
  });

  it("holds a verification step's terminal events, and nothing for a plain action", () => {
    const verify = action('verify', 'run_verification', {
      'inquiry-id': INQUIRY,
      type: 'database',
    });
    expect(waitEventNames(chain([verify]))).toEqual(
      expect.arrayContaining(['verification.passed', 'verification.failed']),
    );
    const asynchronous = action('query', 'run_graph_query', {
      'graph-query-template-id': 'grqt_01M5CK3190XEVBM5ZXA76E1JSN',
      'account-id': 'acc',
      mode: 'asynchronous',
    });
    expect(waitEventNames(chain([asynchronous]))).toEqual([]);
  });
});

describe('scheduleOf (C118.4)', () => {
  const input = { id: 'wfsc_01M5CK3190XEVBM5ZXA76E1JSN', workflowId: 'wfl_x', now: NOW };

  it('is null for a trigger that is not recurring', () => {
    expect(scheduleOf(chain([]), input)).toBeNull();
  });

  it('reads a cron in its zone, with the next fire time and the default batch', () => {
    const definition = chain([], {
      trigger: {
        type: 'trigger-recurring',
        config: { cron: '0 13 * * *', 'time-zone': 'Europe/London', 'object-type': 'account' },
      },
    });
    expect(scheduleOf(definition, input)).toEqual({
      id: input.id,
      workflowId: 'wfl_x',
      cron: '0 13 * * *',
      everyMinutes: null,
      timeZone: 'Europe/London',
      objectType: 'account',
      filter: null,
      onNull: null,
      batchCap: 100,
      nextFireAt: new Date('2026-10-21T12:00:00.000Z'),
    });
  });

  it('reads an interval with its filter and batch', () => {
    const filter = { '===': [{ var: 'trigger.status' }, 'active'] };
    const definition = chain([], {
      trigger: {
        type: 'trigger-recurring',
        config: {
          'every-minutes': 15,
          'time-zone': 'UTC',
          'object-type': 'inquiry',
          filter,
          'on-null': 'skip',
          'batch-cap': 500,
        },
      },
    });
    expect(scheduleOf(definition, input)).toMatchObject({
      cron: null,
      everyMinutes: 15,
      filter,
      onNull: 'skip',
      batchCap: 500,
      nextFireAt: new Date('2026-10-20T12:15:30.000Z'),
    });
  });
});
