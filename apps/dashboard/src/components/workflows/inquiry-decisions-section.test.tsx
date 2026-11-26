import type { InquiryStatus, Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { inquiry, single } from '../../testing/lifecycle-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import { DECISIONS_PATH, serveDecisions } from '../../testing/routes/workflows';
import { WORKFLOW_IDS as IDS, decision, reopenDecision } from '../../testing/workflow-fixtures';
import { ToastProvider } from '../toasts';
import { InquiryDecisionsSection } from './inquiry-decisions-section';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const REVIEWER: Permission[] = ['inquiries:read', 'inquiries:write', 'pii:view'];
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: REVIEWER });
});

afterEach(() => {
  api.restore();
});

const section = (
  permissions: Permission[] = REVIEWER,
  status: InquiryStatus = 'declined',
  redacted = false,
) =>
  InquiryDecisionsSection({
    inquiryId: IDS.inquiry,
    status,
    redacted,
    permissions: new Set(permissions),
  });

const show = async (...args: Parameters<typeof section>) => {
  render(<ToastProvider>{await section(...args)}</ToastProvider>);
};

const record = (name: string) => screen.getByRole('article', { name });
const term = (scope: HTMLElement, name: string) =>
  within(scope).getByText(name, { selector: 'dt' }).nextElementSibling as HTMLElement;

describe('a flow failure (C150.7, Workflow 9A)', () => {
  it('names the inquiry flow as the decider, and says the kind in words', async () => {
    serveDecisions(api, [
      decision({
        kind: 'flow-failure',
        actor: { type: 'inquiry-flow', id: IDS.inquiry },
        run: null,
        flow: {
          'template-version-id': 'itmplv_01M5CN00000000000000009A01',
          'failure-step-id': 'failed_minor',
          routes: [{ 'step-id': 'age_route', port: 'route:minor', 'on-null': null }],
        },
        'solely-automated': true,
        'human-step': null,
        evidence: [
          {
            kind: 'extraction',
            id: null,
            name: 'age-years',
            status: null,
            tier: 'R/H',
            stage: 'beta',
            confidence: null,
          },
        ],
      }),
    ]);

    await show();

    const failed = record('Failed by the flow');
    expect(term(failed, 'Decided by')).toHaveTextContent(`The inquiry's flow ${IDS.inquiry}`);
    expect(failed).toHaveTextContent('Extracted value');
  });
});

describe('InquiryDecisionsSection (C128.1, C142.4)', () => {
  it('reads the records of this inquiry, by its id', async () => {
    serveDecisions(api, [decision()]);

    await section();

    expect(api.find('GET', DECISIONS_PATH)?.query.get('filter[subject-id]')).toBe(IDS.inquiry);
  });

  it('shows a run’s decline in words: the run, a person took part, the basis, the contest route and its host', async () => {
    serveDecisions(api, [decision()]);

    await show();

    const declined = record('Declined');
    expect(within(term(declined, 'Decided by')).getByRole('link')).toHaveAttribute(
      'href',
      `/workflows/runs/${IDS.run}`,
    );
    expect(term(declined, 'Decided by')).toHaveTextContent(`Workflow run ${IDS.run}`);
    expect(term(declined, 'Solely automated')).toHaveTextContent(
      'No: a person took part on the path taken',
    );
    expect(term(declined, 'Person who took part')).toHaveTextContent(
      `Case resolution by ${IDS.user}, resolved on its own (not in bulk)`,
    );
    expect(term(declined, 'Decision basis')).toHaveTextContent('Contract');
    expect(term(declined, 'Contest route')).toHaveTextContent(
      'help.example.com: https://help.example.com/contest',
    );
    expect(term(declined, 'Contest route')).toHaveTextContent('appeals@example.com');
    expect(term(declined, 'Comment')).toHaveTextContent('Synthetic reviewer note');
  });

  it('lists the evidence with each H-tier input’s tier, stage and confidence, and the pending evidence', async () => {
    serveDecisions(api, [decision()]);

    await show();

    const evidence = term(record('Declined'), 'Evidence considered');
    expect(
      within(evidence)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      `Report match ${IDS.match}: matched · H tier · beta · confidence 0.82`,
      'Check id_barcode_detected: passed · R tier',
    ]);
    expect(term(record('Declined'), 'Pending at the decision')).toHaveTextContent(
      `Report ${IDS.report} still pending`,
    );
  });

  it('says a solely automated decision is one, and an undeclared one is not declared, never "no"', async () => {
    serveDecisions(api, [
      decision({ 'solely-automated': true, 'human-step': null }),
      decision(
        {
          kind: 'approve',
          actor: { type: 'api-key', id: IDS.apiKey },
          run: null,
          'solely-automated': null,
          'human-step': null,
          'decision-basis': null,
          'contest-route': null,
          'pending-evidence': [],
        },
        IDS.approve,
      ),
    ]);

    await show();

    expect(term(record('Declined'), 'Solely automated')).toHaveTextContent(
      'Yes: no person took part',
    );
    expect(term(record('Declined'), 'Person who took part')).toHaveTextContent('None');
    const approved = record('Approved');
    expect(term(approved, 'Decided by')).toHaveTextContent(`API key ${IDS.apiKey}`);
    expect(term(approved, 'Solely automated')).toHaveTextContent('Not declared by the caller');
    expect(term(approved, 'Decision basis')).toHaveTextContent('Not declared');
    expect(term(approved, 'Contest route')).toHaveTextContent('Not declared');
    expect(term(approved, 'Pending at the decision')).toHaveTextContent('Nothing');
  });

  it('says a comment is hidden without pii:view, and shows no value the API did not send', async () => {
    api.me({ permissions: ['inquiries:read'] });
    serveDecisions(api, [decision({ comment: null })]);

    await show(['inquiries:read']);

    expect(term(record('Declined'), 'Comment')).toHaveTextContent('Hidden without pii:view');
    expect(await rscPayloadOf(await section(['inquiries:read']))).not.toContain(
      'Synthetic reviewer',
    );
  });

  it('says a redacted inquiry’s comment was redacted', async () => {
    serveDecisions(api, [decision({ comment: null })]);

    await show(REVIEWER, 'declined', true);

    expect(term(record('Declined'), 'Comment')).toHaveTextContent('Redacted');
  });

  it('marks a reopen with human review pending, and the gate that stopped a step', async () => {
    serveDecisions(api, [
      reopenDecision(),
      decision({ 'error-code': 'decision_basis_missing', 'needs-review': true }),
    ]);

    await show(REVIEWER, 'needs_review');

    expect(screen.getByText(/Human review is pending/)).toBeVisible();
    const reopened = record('Reopened for review');
    expect(term(reopened, 'Decided by')).toHaveTextContent(`User ${IDS.user}`);
    expect(term(record('Declined'), 'Stopped by')).toHaveTextContent(
      'decision_basis_missing: the step had no decision basis or contest route',
    );
    expect(term(record('Declined'), 'Needs review')).toHaveTextContent('Yes');
  });

  it('says so when nothing is recorded', async () => {
    serveDecisions(api, []);

    await show(REVIEWER, 'completed');

    expect(screen.getByText('No decision is recorded for this inquiry.')).toBeVisible();
  });
});

describe('the reopen action (C128.6)', () => {
  it('reopens a declined inquiry after a confirmation with a required comment', async () => {
    serveDecisions(api, [decision()]);
    api.on(
      'POST',
      `/inquiries/${IDS.inquiry}/reopen`,
      200,
      single(inquiry({ status: 'needs_review' })),
    );
    const user = userEvent.setup();
    await show();

    await user.click(screen.getByRole('button', { name: 'Reopen for review' }));
    const dialog = screen.getByRole('dialog', { name: 'Reopen this inquiry for review?' });
    expect(within(dialog).getByRole('textbox', { name: /Comment/ })).toBeRequired();
    await user.type(within(dialog).getByRole('textbox', { name: /Comment/ }), 'New evidence');
    await user.click(within(dialog).getByRole('button', { name: 'Reopen inquiry' }));

    await vi.waitFor(() => {
      expect(api.find('POST', `/inquiries/${IDS.inquiry}/reopen`)?.body).toEqual({
        meta: { comment: 'New evidence' },
      });
    });
  });

  it.each([
    ['without inquiries:write', ['inquiries:read', 'pii:view'], 'declined', false],
    ['for an inquiry that is not declined', REVIEWER, 'approved', false],
    ['for a redacted inquiry', REVIEWER, 'declined', true],
  ] as const)('is not offered %s', async (_name, permissions, status, redacted) => {
    serveDecisions(api, [decision()]);

    await show([...permissions], status, redacted);

    expect(screen.queryByRole('button', { name: 'Reopen for review' })).toBeNull();
  });
});
