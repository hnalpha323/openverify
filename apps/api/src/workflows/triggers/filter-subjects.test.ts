/**
 * C143.4 (F14): the webhook filter subject of a workflow, workflow-version, workflow-run or list
 * event comes from its payload's own ids, in order. Synthetic ids.
 */
import { newId } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { resolveWorkflowFilterSubjects } from './filter-subjects.js';

const db = {} as Db;
const environmentId = newId('env');
const workflowId = newId('wfl');
const listId = newId('lst');

const workflowLink = { workflow: { data: { type: 'workflow', id: workflowId } } };

describe('resolveWorkflowFilterSubjects (C143.4)', () => {
  it('reads a workflow’s own id', async () => {
    await expect(
      resolveWorkflowFilterSubjects(db, environmentId, [
        { data: { type: 'workflow', id: workflowId, attributes: {} } },
      ]),
    ).resolves.toEqual([{ workflowId }]);
  });

  it.each(['workflow-version', 'workflow-run'])('reads a %s’s workflow', async (type) => {
    await expect(
      resolveWorkflowFilterSubjects(db, environmentId, [
        { data: { type, id: newId('wfv'), relationships: workflowLink } },
      ]),
    ).resolves.toEqual([{ workflowId }]);
  });

  it('reads a list event’s list', async () => {
    await expect(
      resolveWorkflowFilterSubjects(db, environmentId, [
        { data: { type: 'list/email-address', id: listId, attributes: {} } },
      ]),
    ).resolves.toEqual([{ listId }]);
  });

  it('keeps each subject in its place, and resolves nothing it cannot read', async () => {
    await expect(
      resolveWorkflowFilterSubjects(db, environmentId, [
        null,
        { data: { type: 'workflow-run', id: newId('wfr') } },
        { data: { type: 'workflow', id: workflowId } },
      ]),
    ).resolves.toEqual([{}, {}, { workflowId }]);
  });
});
