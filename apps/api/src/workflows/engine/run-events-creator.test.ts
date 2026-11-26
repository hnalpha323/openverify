/**
 * C120.1 as amended by C152.2 (Workflow 9A Stage 4): a run's resource names its creator for every
 * creator type the run row may hold. A run a flow's `run_workflow` started names `inquiry-flow`
 * and the inquiry (the full-stack `flow-run-workflow.spec.ts` found it read `null`), and a case
 * action's run its `cact_` (8B). Every id is synthetic.
 */
import { WORKFLOW_RUN_CREATOR_TYPES } from '@openverify/core';
import type { WorkflowRunRow } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { creatorOf } from './run-events.js';

const ID_OF: Readonly<Record<(typeof WORKFLOW_RUN_CREATOR_TYPES)[number], string>> = {
  user: 'usr_01JAAAAAAAAAAAAAAAAAAAAAAA',
  'api-key': 'key_01JAAAAAAAAAAAAAAAAAAAAAAA',
  event: 'evt_01JAAAAAAAAAAAAAAAAAAAAAAA',
  'scheduled-run': 'srrun_01JAAAAAAAAAAAAAAAAAAAAAAA',
  'workflow-run': 'wfr_01JAAAAAAAAAAAAAAAAAAAAAAA',
  'account-action': 'accac_01JAAAAAAAAAAAAAAAAAAAAAAA',
  'case-action': 'cact_01JAAAAAAAAAAAAAAAAAAAAAAA',
  'inquiry-flow': 'inq_01JAAAAAAAAAAAAAAAAAAAAAAA',
};

const row = (creatorType: string | null, creatorId: string | null) =>
  ({ creatorType, creatorId }) as unknown as WorkflowRunRow;

describe('creatorOf (C120.1, C152.2)', () => {
  it.each(WORKFLOW_RUN_CREATOR_TYPES.map((type) => [type]))('names a %s creator', (type) => {
    expect(creatorOf(row(type, ID_OF[type]))).toEqual({ type, id: ID_OF[type] });
  });

  it('names no creator for a run without one', () => {
    expect(creatorOf(row(null, null))).toBeNull();
  });
});
