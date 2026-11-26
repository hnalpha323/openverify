import { describe, expect, it } from 'vitest';
import {
  GRAPH_BULK_ACTIONS,
  GRAPH_BULK_OUTCOMES,
  GRAPH_LIMITS,
  GRAPH_MAX_HOPS,
  GRAPH_QUERY_STATUSES,
} from './graph-queries.js';

describe('the graph query vocabularies (C102, C103)', () => {
  it('holds the public statuses', () => {
    expect(GRAPH_QUERY_STATUSES).toEqual([
      'submitted',
      'completed',
      'errored',
      'cancelled',
      'timed_out',
    ]);
  });

  it('counts hops the public way: 2, 4 or 6', () => {
    expect(GRAPH_MAX_HOPS).toEqual([2, 4, 6]);
    expect(GRAPH_LIMITS.defaultMaxHops).toBe(4);
    expect(GRAPH_LIMITS.weakMaxHops).toBe(4);
  });

  it('holds the limits of C102 and C103', () => {
    expect(GRAPH_LIMITS).toMatchObject({
      parameters: 10,
      startClauses: 5,
      defaultNodeLimit: 100,
      nodeLimit: 2000,
      defaultFanOut: 50,
      fanOut: 500,
      defaultTimeoutSeconds: 30,
      timeoutSeconds: 59,
      syncTimeoutSeconds: 10,
      syncPerEnvironment: 2,
      bulkAccounts: 500,
      exportRows: 2000,
      defaultRetentionDays: 30,
      retentionDays: 365,
    });
  });

  it('closes the bulk actions and their outcomes (C103.1, C103.2)', () => {
    expect(GRAPH_BULK_ACTIONS).toEqual([
      'add-tag',
      'remove-tag',
      'set-account-status',
      'add-to-list',
      'export',
      // C140.6 (Workflow 8B): one case holding the selection.
      'create-case',
    ]);
    expect(GRAPH_BULK_OUTCOMES).toEqual([
      'done',
      'skipped_redacted',
      'skipped_consolidated',
      'refused_scope',
    ]);
  });
});
