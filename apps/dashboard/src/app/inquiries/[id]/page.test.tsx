import { selfieCaptureResourceSchema } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import {
  LIFECYCLE_IDS as IDS,
  T1,
  inquiryDocument,
  inquiryEvent,
  session,
  sessionEvent,
  verificationEvent,
} from '../../../testing/lifecycle-fixtures';
import { ToastProvider } from '../../../components/toasts';
import { SELFIE_IDS, selfieInquiryDocument } from '../../../testing/selfie-fixtures';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { fakeRequest } from '../../../testing/fake-request';
import { expectNotFound, redirectTarget } from '../../../testing/next-errors';
import InquiryPage, { metadata } from './page';
import { serveDecisions } from '../../../testing/routes/workflows';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const DETAIL = `/dashboard/inquiries/${IDS.inquiry}`;
const REVIEWER: Permission[] = [
  'inquiries:read',
  'inquiries:write',
  'inquiries:redact',
  'verifications:read',
  'accounts:read',
  'pii:view',
];
const VIEWER: Permission[] = ['inquiries:read', 'verifications:read', 'accounts:read'];
/** A second government ID verification of the inquiry: a retry. */
const RETRY_ID = 'ver_01JB0000000000000000000009';

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveDecisions(api, []);
  api.me({ permissions: REVIEWER });
  api.on('GET', DETAIL, 200, inquiryDocument());
});

afterEach(() => {
  api.restore();
});

const page = (id: string = IDS.inquiry, searchParams: Record<string, string> = {}) =>
  InquiryPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) });

async function renderInquiry(searchParams: Record<string, string> = {}) {
  render(<ToastProvider>{await page(IDS.inquiry, searchParams)}</ToastProvider>);
}

const actionButtons = () =>
  screen.queryByRole('group', { name: 'Inquiry actions' }) === null
    ? []
    : within(screen.getByRole('group', { name: 'Inquiry actions' }))
        .getAllByRole('button')
        .map((button) => button.textContent);

describe('inquiry detail page', () => {
  it('shows the inquiry with its status, reference, template, account and times', async () => {
    await renderInquiry();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(`Inquiry ${IDS.inquiry}`);
    expect(screen.getAllByText('Completed', { selector: '[data-status]' })[0]).toHaveAttribute(
      'data-status',
      'completed',
    );
    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(details).getByText('ref-synthetic-001')).toBeVisible();
    expect(within(details).getByText(IDS.template)).toBeVisible();
    expect(within(details).getByRole('link', { name: IDS.account })).toHaveAttribute(
      'href',
      `/accounts/${IDS.account}`,
    );
    expect(within(details).getByText('Expires (UTC)').nextElementSibling).toHaveTextContent(
      'Oct 21, 2026',
    );
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByRole('link', { name: 'Inquiries' })).toHaveAttribute(
      'href',
      '/inquiries',
    );
  });

  it('links the template version the inquiry pinned, with inquiry-templates:read (C25.4)', async () => {
    api.me({ permissions: [...REVIEWER, 'inquiry-templates:read'] });

    await renderInquiry();

    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(details).getByRole('link', { name: IDS.version })).toHaveAttribute(
      'href',
      `/templates/${IDS.template}/versions/${IDS.version}`,
    );
  });

  it('names the pinned version without a link when the operator cannot read templates', async () => {
    await renderInquiry();

    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(details).getByText('Template version').nextElementSibling).toHaveTextContent(
      IDS.version,
    );
    expect(within(details).queryByRole('link', { name: IDS.version })).not.toBeInTheDocument();
  });

  it('links each verification to its own page (C26)', async () => {
    await renderInquiry();

    const card = screen.getByRole('region', { name: 'Government ID' });
    expect(within(card).getByRole('link', { name: IDS.governmentId })).toHaveAttribute(
      'href',
      `/verifications/${IDS.governmentId}`,
    );
  });

  it('shows an inquiry whose selfie was taken through a capture, which is not a verification (C40.1, C47)', async () => {
    const document = inquiryDocument();
    // The dashboard inquiry document includes the selfie verification's captures (C40.1).
    const capture = selfieCaptureResourceSchema.parse({
      type: 'selfie',
      id: 'self_01JB0000000000000000000010',
      attributes: {
        status: 'processed',
        'capture-method': 'camera',
        liveness: 'active',
        prompts: ['center', 'left', 'right'],
        'prompt-timings': [],
        'created-at': T1,
        'expires-at': T1,
        'submitted-at': T1,
        'processed-at': T1,
        'error-code': null,
      },
      relationships: {
        verification: { data: { type: 'verification/selfie', id: IDS.selfie } },
        inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
      },
    });
    api.on('GET', DETAIL, 200, { ...document, included: [...document.included, capture] });

    await renderInquiry();

    // One card per verification; the capture adds none.
    expect(screen.getByRole('region', { name: 'Government ID' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Selfie' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /attempt 2/ })).toBeNull();
  });

  it('shows the fields to an operator with pii:view', async () => {
    await renderInquiry();

    const fields = screen.getByRole('region', { name: 'Fields' });
    expect(within(fields).getByText('name_first')).toBeVisible();
    expect(within(fields).getByText('Synthetic')).toBeVisible();
    expect(within(fields).getByText('42')).toBeVisible();
  });

  it('offers the decisions a completed inquiry allows, and redaction', async () => {
    await renderInquiry();

    expect(actionButtons()).toEqual(['Approve', 'Decline', 'Mark for review', 'Redact']);
  });

  it('offers only approve and decline for an inquiry that needs review', async () => {
    api.on('GET', DETAIL, 200, inquiryDocument({ status: 'needs_review' }));

    await renderInquiry();

    expect(actionButtons()).toEqual(['Approve', 'Decline', 'Redact']);
  });

  it('shows an inquiry in review with its government ID as Needs review, naming the check that sent it there (C30.5, C37)', async () => {
    const inReview = inquiryDocument({ status: 'needs_review' });
    api.on('GET', DETAIL, 200, {
      ...inReview,
      included: inReview.included.map((resource) =>
        resource.type === 'verification/government-id'
          ? {
              ...resource,
              attributes: {
                ...resource.attributes,
                status: 'needs_review',
                checks: [
                  ...resource.attributes.checks,
                  {
                    name: 'id_public_figure_detection',
                    status: 'not_applicable',
                    reasons: ['provider_not_configured'],
                    requirement: 'required',
                    metadata: {},
                    stage: 'beta',
                    confidence: null,
                    provenance: { 'implementation-version': 1, thresholds: {} },
                  },
                ],
              },
            }
          : resource,
      ),
    });

    await renderInquiry();

    // The inquiry's badge and its government ID's, in the same tone.
    const badges = screen.getAllByText('Needs review', { selector: '[data-status]' });
    expect(badges.map((badge) => badge.getAttribute('data-tone'))).toEqual(['review', 'review']);
    const card = screen.getByRole('region', { name: 'Government ID' });
    expect(within(card).getByText('Needs review')).toHaveAttribute('data-status', 'needs_review');
    expect(within(card).getByRole('note', { name: 'Why it needs review' })).toHaveTextContent(
      'id_public_figure_detection (Not configured)',
    );
    expect(actionButtons()).toEqual(['Approve', 'Decline', 'Redact']);
  });

  it('offers expiry for an inquiry the end user has not finished', async () => {
    api.on('GET', DETAIL, 200, inquiryDocument({ status: 'pending' }));

    await renderInquiry();

    expect(actionButtons()).toEqual(['Expire', 'Redact']);
  });

  it('offers no decision on an approved inquiry', async () => {
    api.on(
      'GET',
      DETAIL,
      200,
      inquiryDocument({ status: 'approved', 'decisioned-at': '2026-10-20T05:00:00.000Z' }),
    );

    await renderInquiry();

    expect(actionButtons()).toEqual(['Redact']);
    expect(
      within(screen.getByRole('region', { name: 'Details' })).getByText('Decided (UTC)')
        .nextElementSibling,
    ).toHaveTextContent('Oct 20, 2026');
  });

  it('offers decisions but not redaction without inquiries:redact', async () => {
    api.me({ permissions: REVIEWER.filter((permission) => permission !== 'inquiries:redact') });

    await renderInquiry();

    expect(actionButtons()).toEqual(['Approve', 'Decline', 'Mark for review']);
  });

  it('shows a viewer "Hidden" fields and images and no action buttons', async () => {
    api.me({ permissions: VIEWER });
    api.on(
      'GET',
      DETAIL,
      200,
      inquiryDocument({ fields: { name_first: null, age: null }, note: null }),
    );

    await renderInquiry();

    expect(actionButtons()).toEqual([]);
    expect(screen.queryByRole('button', { name: /Approve|Decline|Redact|Expire/ })).toBeNull();
    const fields = screen.getByRole('region', { name: 'Fields' });
    expect(within(fields).getAllByText('Hidden')).toHaveLength(2);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Government ID images' })).getAllByText('Hidden'),
    ).toHaveLength(2);
  });

  it('shows the images through the file proxy to an operator with pii:view', async () => {
    await renderInquiry();

    expect(screen.getAllByRole('img').map((image) => image.getAttribute('src'))).toEqual([
      `/files/${IDS.front}/rendition`,
      `/files/${IDS.back}/rendition`,
      `/files/${IDS.selfieCenter}/rendition`,
    ]);
  });

  it('shows the check details with verifications:read only', async () => {
    api.me({ permissions: ['inquiries:read', 'pii:view'] });

    await renderInquiry();

    expect(screen.queryByRole('table', { hidden: true })).not.toBeInTheDocument();
    expect(screen.getAllByText(/verifications:read/)).toHaveLength(2);
  });

  it('gives retried verifications of one type distinct region names and headings (Workflow 2E F015)', async () => {
    const document = inquiryDocument();
    const first = document.included.find((resource) => resource.id === IDS.governmentId);
    if (first?.type !== 'verification/government-id') {
      throw new Error('No government ID verification in the fixture');
    }
    const retry = {
      ...first,
      id: RETRY_ID,
      attributes: { ...first.attributes, status: 'passed' as const, 'created-at': T1 },
      relationships: { ...first.relationships, files: { data: [] } },
    };
    api.on('GET', DETAIL, 200, {
      data: {
        ...document.data,
        relationships: {
          ...document.data.relationships,
          verifications: {
            data: [
              ...document.data.relationships.verifications.data,
              { type: 'verification/government-id', id: RETRY_ID },
            ],
          },
        },
      },
      // The retry first: attempts are numbered by creation time, not by the API's order.
      included: [retry, ...document.included],
    });

    await renderInquiry();

    const attempt1 = screen.getByRole('region', { name: 'Government ID, attempt 1' });
    const attempt2 = screen.getByRole('region', { name: 'Government ID, attempt 2' });
    expect(within(attempt1).getByText(IDS.governmentId)).toBeVisible();
    expect(within(attempt2).getByText(RETRY_ID)).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Government ID, attempt 2' }),
    ).toBeVisible();
    // One attempt of a type keeps the plain name.
    expect(screen.getByRole('region', { name: 'Selfie' })).toBeVisible();
  });

  it('says the verifications need verifications:read when the API leaves them out (Workflow 2D K001)', async () => {
    api.me({ permissions: ['inquiries:read', 'pii:view'] });
    // Without verifications:read the API keeps the relationship ids and includes nothing.
    api.on('GET', DETAIL, 200, { ...inquiryDocument(), included: [] });

    await renderInquiry();

    const section = screen.getByRole('region', { name: 'Verifications' });
    expect(within(section).queryByText('No verifications yet.')).not.toBeInTheDocument();
    expect(section).toHaveTextContent(
      'This inquiry has 2 verifications. Viewing them needs the verifications:read permission.',
    );
  });

  it('shows the redacted state: no fields, no images, no second redaction', async () => {
    api.on(
      'GET',
      DETAIL,
      200,
      inquiryDocument({ 'redacted-at': '2026-10-20T05:00:00.000Z', fields: {}, note: null }),
    );

    await renderInquiry();

    expect(screen.getByRole('status', { name: 'Redacted' })).toHaveTextContent(
      'This inquiry was redacted',
    );
    expect(
      within(screen.getByRole('region', { name: 'Fields' })).getByText('Redacted'),
    ).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Government ID images' })).getAllByText('Redacted'),
    ).toHaveLength(2);
    expect(actionButtons()).toEqual(['Approve', 'Decline', 'Mark for review']);
  });

  it('says when the inquiry has no verifications or fields yet', async () => {
    api.on('GET', DETAIL, 200, {
      ...inquiryDocument({ status: 'created', fields: {} }),
      included: [],
    });

    await renderInquiry();

    expect(screen.getByText('No verifications yet.')).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Fields' })).getByText('No fields.'),
    ).toBeVisible();
  });

  it('is not found when the API does not show it to this session', async () => {
    api.onProblem('GET', DETAIL, 404);

    await expectNotFound(page());
  });

  it('is not found for a malformed id, without calling the API', async () => {
    await expectNotFound(page('not-an-inquiry'));

    expect(api.requests).toHaveLength(0);
  });

  it('sends the operator to sign in when the session has ended', async () => {
    api.onProblem('GET', DETAIL, 401);

    await expect(redirectTarget(page())).resolves.toBe('/login');
  });

  it('shows the forbidden panel without inquiries:read, without reading the inquiry', async () => {
    api.me({ permissions: ['users:read'] });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', DETAIL)).toBeUndefined();
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Inquiry');
  });
});

describe('inquiry page sections', () => {
  const SESSIONS = '/inquiry-sessions';
  const EVENTS = '/events';
  const region = (name: string) => screen.getByRole('region', { name });

  beforeEach(() => {
    api.on('GET', SESSIONS, 200, { data: [session()], links: { next: null } });
    // C108: each session is read again with its device and network.
    api.on('GET', `${SESSIONS}/${IDS.session}`, 200, { data: session(), included: [] });
    api.on('GET', EVENTS, 200, {
      data: [inquiryEvent('inquiry.created')],
      links: {
        next: `/api/v1/events?filter%5Binquiry-id%5D=${IDS.inquiry}&page%5Bafter%5D=${IDS.event}`,
      },
    });
  });

  it('lets an operator who may write edit the tags', async () => {
    await renderInquiry();

    const tags = region('Tags');
    expect(within(tags).getByRole('list', { name: 'Tags' })).toHaveTextContent('vip');
    expect(within(tags).getByRole('button', { name: 'Remove tag vip' })).toBeVisible();
    expect(within(tags).getByRole('textbox', { name: 'New tag' })).toBeVisible();
  });

  it('shows the tags read-only to a viewer', async () => {
    api.me({ permissions: VIEWER });

    await renderInquiry();

    expect(within(region('Tags')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the note, editable with inquiries:write and pii:view', async () => {
    await renderInquiry();

    const note = region('Note');
    expect(within(note).getByText('Synthetic note.')).toBeVisible();
    expect(within(note).getByRole('button', { name: 'Edit note' })).toBeVisible();
  });

  it('shows a masked note as "Hidden" and offers no edit', async () => {
    api.me({ permissions: ['inquiries:read', 'inquiries:write'] });
    api.on('GET', DETAIL, 200, inquiryDocument({ note: null, fields: {} }));

    await renderInquiry();

    const note = region('Note');
    expect(within(note).getByText('Hidden')).toBeVisible();
    expect(within(note).queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers to edit the fields of an open inquiry only', async () => {
    api.on('GET', DETAIL, 200, inquiryDocument({ status: 'pending' }));

    await renderInquiry();

    expect(within(region('Fields')).getByRole('button', { name: 'Edit fields' })).toBeVisible();
  });

  it('offers no field edit once the end user finished', async () => {
    await renderInquiry();

    expect(within(region('Fields')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers a one-time link for an open inquiry', async () => {
    api.on('GET', DETAIL, 200, inquiryDocument({ status: 'created' }));

    await renderInquiry();

    expect(
      within(region('One-time link')).getByRole('button', { name: 'Generate one-time link' }),
    ).toBeVisible();
  });

  it('offers no one-time link for a finished inquiry', async () => {
    await renderInquiry();

    expect(screen.queryByRole('region', { name: 'One-time link' })).not.toBeInTheDocument();
  });

  it("lists the inquiry's sessions with inquiry-sessions:read", async () => {
    api.me({ permissions: [...REVIEWER, 'inquiry-sessions:read', 'inquiry-sessions:write'] });

    await renderInquiry();

    const sessions = region('Sessions');
    expect(within(sessions).getByRole('article', { name: `Session ${IDS.session}` })).toBeVisible();
    expect(within(sessions).getByRole('button', { name: 'Expire' })).toBeVisible();
    expect(Object.fromEntries(api.find('GET', SESSIONS)?.query ?? [])).toEqual({
      'filter[inquiry-id]': IDS.inquiry,
      'page[size]': '100',
    });
  });

  it('reads each session with its device and network (C91.1, C108)', async () => {
    api.me({ permissions: [...REVIEWER, 'inquiry-sessions:read'] });

    await renderInquiry();

    expect(Object.fromEntries(api.find('GET', `${SESSIONS}/${IDS.session}`)?.query ?? [])).toEqual({
      include: 'device,network',
    });
  });

  it('reads no sessions without inquiry-sessions:read', async () => {
    await renderInquiry();

    expect(screen.queryByRole('region', { name: 'Sessions' })).not.toBeInTheDocument();
    expect(api.find('GET', SESSIONS)).toBeUndefined();
  });

  it('shows the forbidden panel in the section when the API refuses the sessions', async () => {
    api.me({ permissions: [...REVIEWER, 'inquiry-sessions:read'] });
    api.onProblem('GET', SESSIONS, 403, 'forbidden');

    await renderInquiry();

    expect(within(region('Sessions')).getByText('You do not have access')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(IDS.inquiry);
  });

  it('shows the timeline with events:read, paged by its own cursor', async () => {
    api.me({ permissions: [...REVIEWER, 'events:read'] });

    await renderInquiry({ 'events-after': IDS.otherEvent });

    const timeline = region('Timeline');
    expect(within(timeline).getByText('Created')).toBeVisible();
    expect(within(timeline).getByRole('link', { name: 'Older events' })).toHaveAttribute(
      'href',
      `/inquiries/${IDS.inquiry}?events-after=${IDS.event}`,
    );
    expect(Object.fromEntries(api.find('GET', EVENTS)?.query ?? [])).toEqual({
      'filter[inquiry-id]': IDS.inquiry,
      'page[size]': '50',
      'page[after]': IDS.otherEvent,
    });
  });

  it("shows the events of the inquiry's verifications and sessions, linking the verification (C25.7, C26)", async () => {
    api.me({ permissions: [...REVIEWER, 'events:read'] });
    api.on('GET', EVENTS, 200, {
      data: [
        verificationEvent('verification.passed', IDS.event),
        sessionEvent('inquiry-session.started', IDS.otherEvent),
      ],
      links: { next: null },
    });

    await renderInquiry();

    const timeline = region('Timeline');
    expect(
      within(timeline).getByRole('link', { name: 'Government ID verification passed' }),
    ).toHaveAttribute('href', `/verifications/${IDS.governmentId}`);
    expect(within(timeline).getByText('Session started')).toBeVisible();
  });

  it('reads no events without events:read', async () => {
    await renderInquiry();

    expect(screen.queryByRole('region', { name: 'Timeline' })).not.toBeInTheDocument();
    expect(api.find('GET', EVENTS)).toBeUndefined();
  });

  it('offers simulate actions in the sandbox', async () => {
    await renderInquiry();

    expect(
      within(region('Sandbox simulation')).getByRole('combobox', { name: 'Simulated action' }),
    ).toBeVisible();
  });

  it('never offers simulate actions in production', async () => {
    api.me({
      permissions: REVIEWER,
      environment: { id: 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y52', kind: 'production' },
    });

    await renderInquiry();

    expect(screen.queryByRole('region', { name: 'Sandbox simulation' })).not.toBeInTheDocument();
  });

  it('offers no simulate actions without inquiries:write', async () => {
    api.me({ permissions: VIEWER });

    await renderInquiry();

    expect(screen.queryByRole('region', { name: 'Sandbox simulation' })).not.toBeInTheDocument();
  });
});

describe('the selfie and its captures on the inquiry page (C40.1, C43, C47)', () => {
  beforeEach(() => {
    api.on('GET', DETAIL, 200, selfieInquiryDocument());
  });

  it('shows the selfie card with its photos in prompt order, the ID comparison, the scores, liveness and prompt timings', async () => {
    await renderInquiry();

    const card = screen.getByRole('region', { name: 'Selfie' });
    expect(
      within(within(card).getByRole('list', { name: 'Selfie images' }))
        .getAllByRole('img', { name: /^Selfie, / })
        .map((image) => image.getAttribute('alt')),
    ).toEqual(['Selfie, center', 'Selfie, right', 'Selfie, left']);
    const comparison = within(card).getByRole('group', { name: 'Compared with the government ID' });
    expect(
      within(comparison).getByText('Show the government ID photo').closest('details'),
    ).not.toHaveAttribute('open');
    expect(within(card).getByRole('table', { name: 'Selfie scores' })).toBeInTheDocument();
    expect(within(card).getByRole('group', { name: 'Selfie liveness' })).toBeVisible();
    expect(within(card).getByRole('table', { name: 'Selfie prompt timings' })).toBeInTheDocument();
  });

  it('lists the inquiry’s captures newest first, each with its verification, status, and why it was not used', async () => {
    await renderInquiry();

    const section = screen.getByRole('region', { name: 'Selfie captures' });
    const table = within(section).getByRole('table', { name: 'Inquiry selfie captures' });
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual([SELFIE_IDS.capture, SELFIE_IDS.supersededCapture]);
    expect(within(table).getAllByRole('link', { name: IDS.selfie })[0]).toHaveAttribute(
      'href',
      `/verifications/${IDS.selfie}`,
    );
    const superseded = within(table).getByRole('row', {
      name: new RegExp(SELFIE_IDS.supersededCapture),
    });
    expect(within(superseded).getByText('Superseded')).toBeVisible();
    expect(
      within(superseded).getByText('A newer capture replaced it before it was submitted.'),
    ).toBeVisible();
  });

  it('counts the captures for an operator without verifications:read', async () => {
    api.me({ permissions: ['inquiries:read', 'pii:view'] });
    const document = selfieInquiryDocument();
    api.on('GET', DETAIL, 200, { ...document, included: [] });

    await renderInquiry();

    expect(screen.getByRole('region', { name: 'Selfie captures' })).toHaveTextContent(
      'This inquiry has 2 selfie captures. Viewing them needs the verifications:read permission.',
    );
  });

  it('has no captures section for an inquiry without captures', async () => {
    api.on('GET', DETAIL, 200, inquiryDocument());

    await renderInquiry();

    expect(screen.queryByRole('region', { name: 'Selfie captures' })).not.toBeInTheDocument();
  });
});
