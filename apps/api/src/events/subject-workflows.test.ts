/**
 * C143.4 (F14; Workflow 8A): a workflow, workflow-version, workflow-run or list event's filter subject
 * comes from its owner's resolver and is strict, so it never reaches a webhook filtered on something
 * it cannot show. Every other subject stays as it was.
 */
import { newId } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventFilterSubjects, toEventSubject } from './subject.js';

const resolver = vi.hoisted(() => vi.fn());
vi.mock('../workflows/triggers/filter-subjects.js', () => ({
  resolveWorkflowFilterSubjects: resolver,
}));

const environmentId = newId('env');
const db = {} as Db;
const payloadOf = (type: string) => ({ data: { type, id: 'x', attributes: {} } });

beforeEach(() => {
  resolver.mockReset();
});

describe('the workflow subjects (C143.4)', () => {
  it.each(['workflow', 'workflow-version', 'workflow-run', 'list/email-address'])(
    'resolves a %s through its owner, strictly',
    async (type) => {
      const workflowId = newId('wfl');
      resolver.mockResolvedValue([{ workflowId }]);
      const payload = payloadOf(type);

      const subjects = await eventFilterSubjects(db, environmentId, [payload]);

      expect(resolver).toHaveBeenCalledWith(db, environmentId, [payload]);
      expect(subjects).toEqual([{ workflowId, strict: true }]);
    },
  );

  it('keeps each subject in its place among others', async () => {
    const listId = newId('lst');
    resolver.mockResolvedValue([{ listId }]);

    const subjects = await eventFilterSubjects(db, environmentId, [
      { data: { type: 'account', id: 'acc', attributes: {} } },
      payloadOf('list/email-address'),
    ]);

    expect(subjects).toEqual([{}, { listId, strict: true }]);
  });

  it('never calls the resolver for an event that is none of these', async () => {
    await eventFilterSubjects(db, environmentId, [
      { data: { type: 'account', id: 'acc', attributes: {} } },
    ]);

    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('toEventSubject (C143.4)', () => {
  it('passes the two new attributes on', () => {
    const workflowId = newId('wfl');
    const listId = newId('lst');

    expect(toEventSubject({ workflowId, listId, strict: true })).toEqual({
      workflowId,
      listId,
      strict: true,
    });
  });

  it('leaves them out when unknown', () => {
    expect(toEventSubject({ workflowId: null })).toEqual({});
  });

  it('passes a case’s template and its held inquiries’ templates on, which the SQL filter reads (C143.4; Workflow 8B Stage 4)', () => {
    const caseTemplateId = newId('ctmpl');
    const held = [newId('itmpl'), newId('itmpl')];

    expect(toEventSubject({ caseTemplateId, heldInquiryTemplateIds: held, strict: true })).toEqual({
      caseTemplateId,
      heldInquiryTemplateIds: held,
      strict: true,
    });
    expect(toEventSubject({ caseTemplateId: null, strict: true })).toEqual({ strict: true });
  });
});
