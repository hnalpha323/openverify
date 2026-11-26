/**
 * C140.5, C128.2 (Workflow 8B, `api-case-workflows`): "Review on report match" end to end on the real
 * engine and the real case services, on both of its paths. A completion report that matched or
 * errored marks its inquiry for review and opens a case holding the inquiry and the report; a person
 * resolves the case through the case service; the run reads the resolution and decides, and its
 * decision record names the person's step. A wait no person answers decides nothing. These are the
 * scenario inputs `integration-8b`'s full-stack spec drives through the routes. Every value is
 * synthetic.
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import type { InquiryStatus, Permission } from '@openverify/core';
import { getInquiry, transitionInquiryStatus } from '@openverify/db';
import { createTestInquiry, seedReport, seedReportTemplate } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../../auth/pii.js';
import { eventCauseOf, runWithEventCause } from '../../../events/cause-context.js';
import { processWorkflowWaitMatch } from '../../../jobs/workflows/wait-match.js';
import type { Principal } from '../../../ports.js';
import type { ApiDependencies } from '../../../services/context.js';
import { setCaseStatus } from '../../../services/cases/service.js';
import { drain, runOf, start, stepOf } from '../../engine/testing.js';
import type { ActionHarness } from '../testing.js';
import { REVIEW_ON_REPORT_MATCH } from './recipes.js';
import { CASE_GRANT, caseOn, createCaseStepHarness, personOf, rowsOf } from './testing.js';

let harness: ActionHarness;

beforeAll(async () => {
  harness = await createCaseStepHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

/** The recipe with the operator's template filled in, as an install and an edit leave it. */
function recipeOn(caseTemplateId: string): WorkflowDefinition {
  return JSON.parse(
    JSON.stringify(REVIEW_ON_REPORT_MATCH.definition()).replaceAll(
      'change-me-case-template-id',
      caseTemplateId,
    ),
  ) as WorkflowDefinition;
}

/** A completed inquiry and its completion report in `status`, as the trigger names them. */
async function completedWithReport(status: 'ready' | 'errored') {
  const { inquiry } = await createTestInquiry(harness.db, harness.environmentId);
  let from: InquiryStatus = 'created';
  for (const to of ['pending', 'completed'] as const) {
    await transitionInquiryStatus(harness.db, harness.environmentId, inquiry.id, { from, to });
    from = to;
  }
  const template = await seedReportTemplate(harness.db, harness.environmentId);
  const reportId = await seedReport(harness.db, harness.environmentId, {
    ...template,
    inquiryId: inquiry.id,
    origin: 'inquiry_completion',
    status,
  });
  return { inquiryId: inquiry.id, reportId };
}

async function startRecipe(event: 'matched' | 'errored') {
  const { templateId } = await caseOn(harness);
  const { inquiryId, reportId } = await completedWithReport(
    event === 'matched' ? 'ready' : 'errored',
  );
  const runId = await start(harness, recipeOn(templateId), {
    triggerType: 'trigger-event',
    trigger: {
      type: 'report/watchlist',
      id: reportId,
      origin: 'inquiry_completion',
      inquiry: { type: 'inquiry', id: inquiryId },
    },
    subjectIds: [reportId, inquiryId],
    grant: CASE_GRANT,
  });
  await drain(harness);
  const [held] = await rowsOf<{ case_id: string }>(
    harness,
    'select case_id from case_inquiries where inquiry_id = $1',
    [inquiryId],
  );
  return { runId, inquiryId, reportId, caseId: held?.case_id ?? '' };
}

/** A person who reads and writes cases and decides inquiries, as a session holds them. */
async function reviewer(): Promise<Principal> {
  const permissions: Permission[] = ['cases:read', 'cases:write', 'inquiries:write'];
  const userId = await personOf(harness, permissions);
  return {
    kind: 'user',
    userId,
    userSessionId: 'synthetic-session',
    organizationId: harness.organizationId,
    environmentId: harness.environmentId,
    environmentKind: 'sandbox',
    permissions: new Set(permissions),
    mfaSatisfied: true,
  } as unknown as Principal;
}

/** The person resolves the case through the case service; the wait reads the event it fires. */
async function resolveAs(principal: Principal, caseId: string, status: 'approved' | 'declined') {
  const actor =
    principal.kind === 'user'
      ? { type: 'user' as const, id: principal.userId }
      : { type: 'api-key' as const, id: principal.apiKeyId };
  await runWithEventCause(eventCauseOf(principal), () =>
    setCaseStatus(
      harness.services as unknown as ApiDependencies,
      {
        ctx: { environmentId: harness.environmentId, organizationId: harness.organizationId },
        actor,
        mask: UNMASKED,
        environmentKind: 'sandbox',
        principal,
      },
      caseId,
      { meta: { status } },
    ),
  );
  for (const job of harness.waitMatches.jobs.splice(0)) {
    await processWorkflowWaitMatch(job, harness.deps);
  }
  await drain(harness);
}

const statusOf = async (id: string) =>
  (await getInquiry(harness.db, harness.environmentId, id))?.status;

describe('Review on report match (C140.5)', () => {
  it('on a match: reviews, opens a case holding the inquiry and the report, and waits', async () => {
    const { runId, inquiryId, reportId, caseId } = await startRecipe('matched');

    expect((await runOf(harness, runId)).status).toBe('in_progress');
    expect(await statusOf(inquiryId)).toBe('needs_review');
    expect(caseId).toMatch(/^case_/);
    expect(
      await rowsOf(harness, 'select report_id from case_reports where case_id = $1', [caseId]),
    ).toEqual([{ report_id: reportId }]);
    expect((await stepOf(harness, runId, 'review_case')).status).toBe('waiting');
  });

  it('on a match the person declines: the run declines, recording the person’s step', async () => {
    const { runId, inquiryId, caseId } = await startRecipe('matched');
    await resolveAs(await reviewer(), caseId, 'declined');

    expect((await runOf(harness, runId)).status).toBe('completed');
    expect(await statusOf(inquiryId)).toBe('declined');
    const decisions = await harness.decisions(inquiryId);
    expect(decisions.map(({ kind }) => kind).sort()).toEqual(['decline', 'review']);
    expect(decisions.find(({ kind }) => kind === 'decline')).toMatchObject({
      kind: 'decline',
      actorType: 'workflow-run',
      actorId: runId,
      solelyAutomated: false,
      humanStep: expect.objectContaining({ kind: 'case-resolution' }) as unknown,
    });
  });

  it('on an error the person approves: the run approves, because a person reviewed it', async () => {
    const { runId, inquiryId, caseId } = await startRecipe('errored');
    expect(await statusOf(inquiryId)).toBe('needs_review');
    await resolveAs(await reviewer(), caseId, 'approved');

    expect((await runOf(harness, runId)).status).toBe('completed');
    expect(await statusOf(inquiryId)).toBe('approved');
    const decisions = await harness.decisions(inquiryId);
    expect(decisions.map(({ kind }) => kind).sort()).toEqual(['approve', 'review']);
    expect(decisions.find(({ kind }) => kind === 'approve')).toMatchObject({
      solelyAutomated: false,
      humanStep: expect.objectContaining({ kind: 'case-resolution' }) as unknown,
    });
  });
});
