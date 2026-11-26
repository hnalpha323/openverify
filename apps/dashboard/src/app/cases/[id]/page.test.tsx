/**
 * C142.2 (decision 70): the case page's fixed default layout, each module shown with its permission.
 * The header says the status and its category, the resolution, the assignee, the queue and the SLA
 * in words; the held objects are grouped by type, "as attached" beside the live state read through
 * each object's own route and scope ("No access" otherwise); the timeline and comments read newest
 * first; attachments say how they were scanned; case actions carry their parameter forms; and the
 * Phase 7 modules reuse their components.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { expectNotFound } from '../../../testing/next-errors';
import {
  ATTACHMENT_NAME,
  COMMENT_TEXT,
  FIELD_VALUE,
  NOW,
  PREFILLED_VALUE,
  QUEUE_NAME,
  REVIEWER_IDS as IDS,
  TEMPLATE_NAME,
  attachment,
  availableActions,
  caseResource,
  comment,
  maskedCaseResource,
} from '../../../testing/reviewer-fixtures';
import {
  CASE_DEVELOPER,
  CASE_PATH,
  CASE_READER,
  CASE_REVIEWER,
  serveCase,
  serveHeldObjects,
  serveModules,
} from '../../../testing/routes/reviewer';
import { selfieInquiryDocument, selfieVerification } from '../../../testing/selfie-fixtures';
import { device, network, phase7Session, sessionDocument } from '../../../testing/signals-fixtures';
import CasePage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// `@panzoom/panzoom` is an ES module whose `main` is a UMD build: bundlers read its `module`
// entry, and Vitest, which follows `main`, is pointed at the same ES build here.
vi.mock('@panzoom/panzoom', async () => {
  const entry = '@panzoom/panzoom/dist/panzoom.es.js';
  return (await import(/* @vite-ignore */ entry)) as typeof import('@panzoom/panzoom');
});
// The attachment upload refreshes the page through the app router, which a test does not mount.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let api: RouteApi;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
  vi.useRealTimers();
});

async function renderCase(id: string = IDS.case) {
  const page = await CasePage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  render(<ToastProvider>{page}</ToastProvider>);
}

const region = (name: string) => screen.getByRole('region', { name });
/** The value (`<dd>`) of a term (`<dt>`) inside `scope`. */
function term(scope: HTMLElement, name: string): HTMLElement {
  const dt = within(scope)
    .getAllByText(name, { exact: true })
    .find((element) => element.tagName === 'DT');
  const dd = dt?.nextElementSibling;
  if (!(dd instanceof HTMLElement)) {
    throw new Error(`no term ${name}`);
  }
  return dd;
}

function asReviewer() {
  api.me({ permissions: CASE_REVIEWER });
  serveCase(api);
  serveHeldObjects(api);
  serveModules(api);
}

describe('the case page (C142.2)', () => {
  it('says in its header the status and its category, the resolution, the assignee, the queue and the SLA time left in words', async () => {
    asReviewer();
    await renderCase();

    expect(metadata.title).toBe('Case');
    expect(screen.getByRole('heading', { level: 1, name: 'REVIEW-7' })).toBeVisible();
    const details = screen.getByRole('group', { name: 'Case details' });
    expect(
      within(term(details, 'Template')).getByRole('link', { name: TEMPLATE_NAME }),
    ).toHaveAttribute('href', `/case-templates/${IDS.template}`);
    expect(term(details, 'Status')).toHaveTextContent('Open');
    expect(term(details, 'Category')).toHaveTextContent('Initial');
    expect(term(details, 'Resolution')).toHaveTextContent('Not resolved');
    expect(term(details, 'Assignee')).toHaveTextContent(IDS.colleague);
    expect(term(details, 'Queue')).toHaveTextContent(QUEUE_NAME);
    expect(term(details, 'SLA')).toHaveTextContent('Running: 2 hours 5 minutes left');
    expect(api.find('GET', CASE_PATH)?.query.get('include')).toBe('case-template');
  });

  it('keeps its details a plain description list inside the named group, so each term keeps its list (axe dlitem, Workflow 8D review R001)', async () => {
    asReviewer();
    await renderCase();

    const details = screen.getByRole('group', { name: 'Case details' });
    // A role on the <dl> itself takes its list semantics from every <dt> and <dd> (WCAG 1.3.1).
    expect(details.tagName).not.toBe('DL');
    const lists = details.querySelectorAll('dl');
    expect(lists).toHaveLength(1);
    expect(lists[0]).not.toHaveAttribute('role');
    expect(lists[0]?.querySelectorAll('dt').length).toBeGreaterThanOrEqual(7);
  });

  it('offers only the statuses the version’s transition map allows from the current one', async () => {
    asReviewer();
    await renderCase();

    const control = within(region('Status')).getByRole('combobox', { name: 'New status' });
    expect(
      within(control)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose a status', 'Pending', 'Approved', 'Declined']);
  });

  it('groups the held objects by type, with the state as attached beside the live one, each linked to its own page', async () => {
    asReviewer();
    await renderCase();

    const held = region('Held objects');
    const inquiries = within(held).getByRole('table', { name: 'Inquiries held by this case' });
    const row = within(inquiries).getByRole('row', { name: new RegExp(IDS.inquiry) });
    expect(within(row).getByRole('link', { name: IDS.inquiry })).toHaveAttribute(
      'href',
      `/inquiries/${IDS.inquiry}`,
    );
    expect(row).toHaveTextContent('status: completed');
    expect(row).toHaveTextContent('needs review');
    expect(within(held).getByRole('table', { name: 'Accounts held by this case' })).toBeVisible();
    expect(within(held).getByRole('table', { name: 'Reports held by this case' })).toBeVisible();
    expect(
      within(held).getByRole('table', { name: 'Transactions held by this case' }),
    ).toBeVisible();
  });

  it('decides the held inquiry only through buttons that each ask for a confirmation', async () => {
    asReviewer();
    await renderCase();

    const row = within(region('Held objects')).getByRole('row', {
      name: new RegExp(IDS.inquiry),
    });
    expect(within(row).getByRole('button', { name: `Approve ${IDS.inquiry}` })).toBeVisible();
    expect(within(row).getByRole('button', { name: `Decline ${IDS.inquiry}` })).toBeVisible();
    expect(screen.queryAllByRole('button', { name: /^(Approve|Decline)/ })).toHaveLength(2);
    // No decision has a shortcut (C142.4): no access key anywhere, and no chord on a decision.
    expect(document.querySelectorAll('[accesskey]')).toHaveLength(0);
    for (const button of screen.getAllByRole('button', { name: /^(Approve|Decline)/ })) {
      expect(button).not.toHaveAttribute('aria-keyshortcuts');
    }
  });

  it('shows "No access" for a held object the reader may not see, with no link and no live read', async () => {
    api.me({ permissions: CASE_READER });
    serveCase(api);
    await renderCase();

    const row = within(region('Held objects')).getByRole('row', {
      name: new RegExp(IDS.inquiry),
    });
    expect(row).toHaveTextContent('No access');
    expect(within(row).queryByRole('link')).toBeNull();
    expect(api.find('GET', `/dashboard/inquiries/${IDS.inquiry}`)).toBeUndefined();
    expect(api.find('GET', `/accounts/${IDS.account}`)).toBeUndefined();
  });

  it('reads the timeline newest first, in words, with the comment it names', async () => {
    asReviewer();
    await renderCase();

    const items = within(within(region('Timeline')).getByRole('list', { name: 'Case timeline' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items).toHaveLength(4);
    expect(items[0]).toContain('Comment added');
    expect(items[0]).toContain(COMMENT_TEXT);
    expect(items[1]).toContain('Status changed from Pending to Open');
    expect(items[2]).toContain(`Assigned to ${IDS.colleague}`);
    expect(items[3]).toContain('Created');
  });

  it('shows comments as plain text: a mention, an id as a link, and a web address only as text with its host before any link', async () => {
    asReviewer();
    await renderCase();

    const comments = region('Comments');
    const item = within(comments).getByRole('article', { name: new RegExp(IDS.comment) });
    expect(item).toHaveTextContent(COMMENT_TEXT);
    expect(item).toHaveTextContent('@you');
    expect(within(item).getByRole('link', { name: IDS.inquiry })).toHaveAttribute(
      'href',
      `/inquiries/${IDS.inquiry}`,
    );
    expect(within(item).queryByRole('link', { name: /docs\.example\.test/ })).toBeNull();
    expect(item).toHaveTextContent('https://docs.example.test/guide');
    expect(within(item).getByText('Open link')).toBeVisible();
    expect(item.querySelector('img, iframe, script')).toBeNull();
    expect(within(comments).getByRole('textbox', { name: 'New comment' })).toBeVisible();
    expect(within(comments).getByRole('combobox', { name: 'Mention' })).toBeVisible();
  });

  it('says how each attachment was scanned, "sandbox scan (not a real scan)" for the sandbox, and downloads only its rendition', async () => {
    api.me({ permissions: CASE_REVIEWER });
    serveCase(api, {
      resource: caseResource({
        attachments: [
          attachment(),
          attachment({
            id: IDS.pdf,
            filename: 'synthetic-statement.pdf',
            attachmentType: 'pdf',
            scanStatus: 'not_scanned',
            scanProvider: null,
            scannedAt: null,
            pageCount: 2,
          }),
        ],
      }),
    });
    serveHeldObjects(api);
    serveModules(api);
    await renderCase();

    const table = within(region('Attachments')).getByRole('table', {
      name: 'Attachments of this case',
    });
    const jpeg = within(table).getByRole('row', { name: new RegExp(ATTACHMENT_NAME) });
    expect(jpeg).toHaveTextContent('Clean, sandbox scan (not a real scan)');
    expect(within(jpeg).getByRole('link', { name: `Download ${IDS.attachment}` })).toHaveAttribute(
      'href',
      `/cases/${IDS.case}/attachments/${IDS.attachment}/content?page=1`,
    );
    const pdf = within(table).getByRole('row', { name: /synthetic-statement\.pdf/ });
    expect(pdf).toHaveTextContent('Not scanned: no scanner is configured');
    expect(within(pdf).getAllByRole('link', { name: /^Download/ })).toHaveLength(2);
    expect(within(region('Attachments')).getByLabelText('File')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp,application/pdf',
    );
  });

  it('lists the case actions the reviewer may run, each with its parameter form prefilled as the API answered', async () => {
    asReviewer();
    await renderCase();

    const actions = region('Case actions');
    const form = within(actions).getByRole('group', { name: 'Re-screen the account' });
    expect(within(form).getByRole('textbox', { name: /reference/ })).toHaveValue(PREFILLED_VALUE);
    expect(within(form).getByRole('spinbutton', { name: /priority/ })).toHaveValue(null);
    expect(within(form).getByRole('button', { name: 'Run Re-screen the account' })).toBeVisible();
  });

  it('shows the Phase 7 modules and the transaction module, each read through its own route', async () => {
    asReviewer();
    await renderCase();

    expect(within(region('List matches')).getByRole('table')).toBeVisible();
    expect(region('Graph')).toHaveTextContent('Linked through strong identifiers');
    expect(region('Signals')).toBeVisible();
    expect(within(region('Transactions')).getAllByRole('table').length).toBeGreaterThan(0);
    expect(api.find('GET', '/list-matches')?.query.get('filter[inquiry-id]')).toBe(IDS.inquiry);
    expect(api.find('GET', `/accounts/${IDS.account}/graph-component`)).toBeDefined();
  });

  it('sends the case with a list-match dismissal, so the case page is refreshed as well (K8-39)', async () => {
    asReviewer();
    await renderCase();

    const matches = region('List matches');
    fireEvent.click(within(matches).getByRole('button', { name: /^Dismiss list match / }));

    const fields = Object.fromEntries(
      [...document.querySelectorAll<HTMLInputElement>('input[type="hidden"]')]
        .filter((input) => input.form?.querySelector('textarea[name="reason"]') !== null)
        .map((input) => [input.name, input.value]),
    );
    expect(fields).toMatchObject({ 'inquiry-id': IDS.inquiry, 'case-id': IDS.case });
  });

  it('leaves out each module its permission does not allow, and calls none of their routes', async () => {
    api.me({ permissions: CASE_READER });
    serveCase(api);
    await renderCase();

    for (const name of [
      'List matches',
      'Graph',
      'Signals',
      'Device',
      'Location',
      'Transactions',
      'Case actions',
      'Attachments',
    ]) {
      expect(screen.queryByRole('region', { name })).toBeNull();
    }
    expect(api.find('GET', '/list-matches')).toBeUndefined();
    expect(api.find('GET', `${CASE_PATH}/available-actions`)).toBeUndefined();
    expect(screen.queryByRole('textbox', { name: 'New comment' })).toBeNull();
  });

  it('shows a reader without pii:view what the API masked as hidden, never as empty', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveCase(api, {
      resource: maskedCaseResource(),
      comments: [comment({ message: null })],
    });
    api.on('GET', `${CASE_PATH}/available-actions`, 200, availableActions(null));
    serveHeldObjects(api);
    await renderCase();

    expect(term(region('Fields'), 'full-name')).toHaveTextContent('Hidden');
    expect(screen.queryByText(FIELD_VALUE)).toBeNull();
    const item = within(region('Comments')).getByRole('article', {
      name: new RegExp(IDS.comment),
    });
    expect(item).toHaveTextContent('Hidden');
    expect(
      within(
        within(region('Case actions')).getByRole('group', { name: 'Re-screen the account' }),
      ).getByRole('textbox', { name: /reference/ }),
    ).toHaveValue('');
  });

  it('offers the redaction behind a typed confirmation to cases:redact, and print to every reader', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveCase(api, { resource: maskedCaseResource() });
    serveHeldObjects(api);
    await renderCase();

    expect(screen.getByRole('button', { name: 'Redact case' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Print' })).toBeVisible();
  });

  it('says a redacted case is redacted, and offers no edit', async () => {
    asReviewer();
    serveCase(api, {
      resource: caseResource({
        redactedAt: new Date(NOW),
        fields: null,
        tags: [],
        attachments: [],
      }),
      comments: [comment({ message: null, redactedAt: new Date(NOW) })],
    });
    await renderCase();

    expect(screen.getByRole('status', { name: 'Redacted' })).toHaveTextContent(
      'This case was redacted',
    );
    expect(screen.queryByRole('textbox', { name: 'New comment' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'New status' })).toBeNull();
  });

  it('answers not found for an id that is not a case, without calling the API', async () => {
    api.me({ permissions: CASE_REVIEWER });
    await expectNotFound(
      CasePage({
        params: Promise.resolve({ id: 'inq_01JE0000000000000000000001' }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(api.requests.filter((request) => request.path.startsWith('/cases'))).toHaveLength(0);
  });

  it('shows the forbidden panel without cases:read', async () => {
    api.me({ permissions: ['inquiries:read'] });
    await renderCase();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(screen.getByText('cases:read')).toBeVisible();
  });

  it('gives the compare panel’s shortcut target the console focus ring, as the timeline has (R014, WCAG 2.4.7)', async () => {
    asReviewer();
    await renderCase();

    const target = region('Compare').querySelector('[data-shortcut-target="compare"]');
    expect(target).not.toBeNull();
    const classes = (target?.getAttribute('class') ?? '').split(/\s+/);
    expect(classes).not.toContain('focus-visible:outline-none');
    expect(classes).toEqual(
      expect.arrayContaining([
        'focus-visible:outline-2',
        'focus-visible:outline-offset-2',
        'focus-visible:outline-focus',
      ]),
    );
  });

  it('compares the ID front with the centre selfie, with the similarity, threshold, basis and result as the selfie card shows them (C142.3)', async () => {
    asReviewer();
    api.on('GET', `/dashboard/inquiries/${IDS.inquiry}`, 200, selfieInquiryDocument());
    await renderCase();

    const compare = region('Compare');
    expect(
      within(compare).getByRole('group', { name: 'Government ID front viewer' }),
    ).toBeVisible();
    expect(
      within(compare).getByRole('group', { name: 'Selfie, centre pose viewer' }),
    ).toBeVisible();
    const similarity = selfieVerification().attributes['document-similarity-score'];
    expect(term(compare, 'Similarity')).toHaveTextContent(
      similarity === null || similarity === undefined ? 'Not measured' : similarity.toFixed(4),
    );
    expect(term(compare, 'Threshold')).not.toHaveTextContent('');
    expect(term(compare, 'Threshold basis')).not.toHaveTextContent('');
    expect(term(compare, 'Result')).toHaveTextContent('Passed');
    expect(compare).toHaveTextContent('Beta');
    expect(compare).not.toHaveTextContent(/\bmatch\b/i);
    expect(within(compare).getAllByRole('img')[0]).toHaveAttribute(
      'src',
      expect.stringMatching(/^\/files\/file_[0-9A-Z]{26}\/rendition$/),
    );
  });

  it('shows no image in the compare panel without pii:view, only the numbers', async () => {
    api.me({ permissions: CASE_REVIEWER.filter((permission) => permission !== 'pii:view') });
    serveCase(api, { resource: maskedCaseResource() });
    serveHeldObjects(api);
    serveModules(api);
    api.on('GET', `/dashboard/inquiries/${IDS.inquiry}`, 200, selfieInquiryDocument());
    await renderCase();

    const compare = region('Compare');
    expect(within(compare).queryAllByRole('img')).toHaveLength(0);
    expect(compare).toHaveTextContent('Hidden');
    expect(term(compare, 'Result')).toHaveTextContent('Passed');
  });

  it('closes the location module with the DB-IP line wherever an IP location shows (C92.8)', async () => {
    asReviewer();
    const session = phase7Session();
    api.on('GET', '/inquiry-sessions', 200, { data: [session], links: { next: null } });
    api.on(
      'GET',
      `/inquiry-sessions/${session.id}`,
      200,
      sessionDocument(session, [device(), network()]),
    );
    await renderCase();

    const location = region('Location');
    expect(within(location).getByRole('link', { name: 'IP geolocation by DB-IP' })).toHaveAttribute(
      'href',
      'https://db-ip.com',
    );
    expect(within(region('Device')).getByText(session.id)).toBeVisible();
  });

  it('puts the newest ID front beside the selfie when no comparison names one, saying it was not compared', async () => {
    asReviewer();
    await renderCase();

    const compare = region('Compare');
    expect(
      within(within(compare).getByRole('group', { name: 'Government ID front viewer' })).getByRole(
        'img',
        { name: 'Government ID front, not compared' },
      ),
    ).toBeVisible();
    expect(compare).toHaveTextContent('No comparison names a document');
    expect(term(compare, 'Result')).toHaveTextContent('Failed');
  });

  it('offers the exports to cases:export, and to nobody else (C138.1, C142.2)', async () => {
    api.me({ permissions: [...CASE_REVIEWER, 'cases:export'] });
    serveCase(api);
    serveHeldObjects(api);
    serveModules(api);
    await renderCase();

    expect(screen.getByRole('link', { name: 'Exports' })).toHaveAttribute('href', '/cases/exports');
  });

  it('offers no export without cases:export', async () => {
    asReviewer();
    await renderCase();

    expect(screen.queryByRole('link', { name: 'Exports' })).toBeNull();
  });
});
