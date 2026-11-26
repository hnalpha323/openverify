// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPORT_PROBLEM_WORDS, REVIEW_NEEDS_PII_VIEW } from '../../lib/report-problem-words';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { REPORT_IDS, report } from '../../testing/report-fixtures';
import {
  addReportTag,
  createReport,
  dismissReportMatches,
  pauseReport,
  redactReport,
  removeReportTag,
  resumeReport,
  reviewReportMatches,
  runReport,
  setReportTags,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ID = REPORT_IDS.report;
const PAGE = `/reports/${ID}`;
let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

const as = (...permissions: Permission[]) => api.me({ permissions });
const single = (data: unknown) => ({ data });
const FORBIDDEN = { ok: false, problem: { title: 'You do not have access' } };

describe('createReport (C72.1, C86)', () => {
  const fields = {
    'environment-id': ENVIRONMENTS.sandbox.id,
    'report-template-id': REPORT_IDS.template,
    type: 'report/watchlist',
    'query/name-first': 'Avery',
    'query/name-middle': '',
    'query/name-last': 'Quillfeather',
    'query/birthdate': '1980-04-12',
    'query/additional-names/0/name-first': 'Ava',
    'query/additional-names/0/name-last': 'Quill',
    'query/additional-names/1/name-first': '',
  };

  it('creates the report from its template and the typed query, and answers its id', async () => {
    as('reports:read', 'reports:write');
    api.on('POST', '/reports', 201, single(report('watchlist')));

    const result = await createReport(null, form(fields));

    expect(result).toEqual({ ok: true, data: { id: ID } });
    expect(api.find('POST', '/reports')?.body).toEqual({
      data: {
        type: 'report/watchlist',
        attributes: {
          'report-template-id': REPORT_IDS.template,
          query: {
            'name-first': 'Avery',
            'name-last': 'Quillfeather',
            birthdate: '1980-04-12',
            'additional-names': [{ 'name-first': 'Ava', 'name-last': 'Quill' }],
          },
        },
      },
      meta: { 'auto-create-account': false },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/reports');
  });

  it('links an account the operator names, or creates one only when asked', async () => {
    as('reports:read', 'reports:write', 'accounts:read');
    api.on('POST', '/reports', 201, single(report('watchlist')));

    await createReport(null, form({ ...fields, 'account-id': REPORT_IDS.account }));
    expect(api.find('POST', '/reports')?.body).toMatchObject({
      data: { attributes: { 'account-id': REPORT_IDS.account } },
      meta: { 'auto-create-account': false },
    });

    await createReport(null, form({ ...fields, 'auto-create-account': 'true' }));
    expect(api.find('POST', '/reports')?.body).toMatchObject({
      meta: { 'auto-create-account': true },
    });
  });

  it('refuses a query the type does not take on its field, without calling the API', async () => {
    as('reports:read', 'reports:write');

    await expect(
      createReport(null, form({ ...fields, 'query/birthdate': '1980-13' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        title: 'Check the values you entered',
        errors: [
          {
            pointer: '/data/attributes/query/birthdate',
            detail: 'must be YYYY, YYYY-MM or YYYY-MM-DD',
          },
        ],
      },
    });
    await expect(
      createReport(null, form({ ...fields, 'query/name-first': '', 'query/name-last': '' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        errors: [
          { pointer: '/data/attributes/query/term', detail: 'needs name-first, name-last or term' },
        ],
      },
    });
    expect(api.find('POST', '/reports')).toBeUndefined();
  });

  it('shows the API’s 422 on the query field by its pointer, titled in words', async () => {
    as('reports:read', 'reports:write');
    api.onProblem('POST', '/reports', 422, undefined, {
      title: 'Unprocessable Content',
      code: 'report_query_invalid',
      errors: [{ pointer: '/data/attributes/query/name-last', detail: 'must contain a letter' }],
    });

    const result = await createReport(null, form(fields));

    expect(result).toMatchObject({
      ok: false,
      problem: {
        title: REPORT_PROBLEM_WORDS.report_query_invalid,
        errors: [{ pointer: '/data/attributes/query/name-last', detail: 'must contain a letter' }],
      },
    });
  });

  it('saves nothing when the environment changed in another tab, or without reports:write', async () => {
    as('reports:read', 'reports:write');
    await expect(
      createReport(null, form({ ...fields, 'environment-id': ENVIRONMENTS.production.id })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'The environment changed' } });

    as('reports:read');
    await expect(createReport(null, form(fields))).resolves.toMatchObject(FORBIDDEN);
    expect(api.find('POST', '/reports')).toBeUndefined();
  });

  it('refuses an unknown type before anything else', async () => {
    as('reports:read', 'reports:write');

    await expect(
      createReport(null, form({ ...fields, type: 'report/unknown' })),
    ).resolves.toMatchObject({ ok: false, problem: { errors: [{ pointer: '/data/type' }] } });
  });

  describe('a query field the form never renders (Workflow 6B R012)', () => {
    const POLLUTED = 'polluted';
    const prototypes = [Object.prototype, Array.prototype] as unknown as Record<string, unknown>[];
    const UNKNOWN_FIELD = {
      ok: false,
      problem: {
        title: 'Check the values you entered',
        errors: [
          { pointer: '/data/attributes/query', detail: 'has a field the query does not take' },
        ],
      },
    };

    afterEach(() => {
      for (const prototype of prototypes) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- undoes a RED run's pollution
        delete prototype[POLLUTED];
      }
    });

    it.each([
      'query/__proto__/polluted',
      'query/constructor/prototype/polluted',
      'query/additional-names/__proto__/polluted',
      'query/additional-names/constructor/prototype/polluted',
      'query/additional-names/0/__proto__/polluted',
      'query/additional-names/0/constructor/prototype/polluted',
    ])('refuses %s without touching a prototype or calling the API', async (name) => {
      as('reports:read', 'reports:write');
      api.on('POST', '/reports', 201, single(report('watchlist')));

      const result = await createReport(null, form({ ...fields, [name]: 'yes' })).catch(
        (error: unknown) => error,
      );

      expect(prototypes.map((prototype) => prototype[POLLUTED])).toEqual([undefined, undefined]);
      expect(result).toMatchObject(UNKNOWN_FIELD);
      expect(api.find('POST', '/reports')).toBeUndefined();
    });

    it.each([
      'query/additional-names/3/name-first',
      'query/additional-names/01/name-first',
      'query/additional-names/42/name-first',
      'query/additional-names/0/birthdate',
      'query/additional-names/0/name-first/0',
      'query/additional-names',
      'query/name-first/0',
      'query/polluted',
      'query/',
    ])('refuses %s, a shape the create form never sends', async (name) => {
      as('reports:read', 'reports:write');
      api.on('POST', '/reports', 201, single(report('watchlist')));

      await expect(createReport(null, form({ ...fields, [name]: 'Ada' }))).resolves.toMatchObject(
        UNKNOWN_FIELD,
      );
      expect(api.find('POST', '/reports')).toBeUndefined();
    });

    it('still leaves a member of another type to the type’s own schema', async () => {
      as('reports:read', 'reports:write');

      await expect(
        createReport(null, form({ ...fields, 'query/lei': '5493001KJTIIGC8Y1R12' })),
      ).resolves.toMatchObject({
        ok: false,
        problem: { errors: [{ pointer: '/data/attributes/query' }] },
      });
      expect(api.find('POST', '/reports')).toBeUndefined();
    });
  });
});

describe('dismissReportMatches (C75.2)', () => {
  it('dismisses the open matches with the reason under data.attributes, and refreshes the page', async () => {
    as('reports:read', 'reports:review', 'pii:view');
    api.on('POST', `${PAGE}/dismiss`, 200, single(report('watchlist')));

    const result = await dismissReportMatches(
      null,
      form({ 'report-id': ID, reason: '  Synthetic: not the listed party  ' }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', `${PAGE}/dismiss`)?.body).toEqual({
      data: { attributes: { reason: 'Synthetic: not the listed party' } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
  });

  it('dismisses one entry, or one article, by its entity id', async () => {
    as('reports:read', 'reports:review', 'pii:view');
    api.on('POST', `${PAGE}/dismiss`, 200, single(report('adverse-media')));

    await dismissReportMatches(
      null,
      form({
        'report-id': ID,
        reason: 'Synthetic: another person',
        'entity-id': 'article:dd15433ebeadb6f6209c13d9381ca685',
        'dismiss-type': 'media',
      }),
    );

    expect(api.find('POST', `${PAGE}/dismiss`)?.body).toEqual({
      data: {
        attributes: {
          reason: 'Synthetic: another person',
          'entity-id': 'article:dd15433ebeadb6f6209c13d9381ca685',
          'dismiss-type': 'media',
        },
      },
    });
  });

  it('requires a reason, shown on its field, without calling the API', async () => {
    as('reports:read', 'reports:review', 'pii:view');

    const result = await dismissReportMatches(null, form({ 'report-id': ID, reason: ' ' }));

    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/reason' }] },
    });
    expect(api.find('POST', `${PAGE}/dismiss`)).toBeUndefined();
  });

  it('needs reports:review and pii:view: nobody dismisses evidence they cannot see', async () => {
    as('reports:read', 'reports:review');

    await expect(
      dismissReportMatches(null, form({ 'report-id': ID, reason: 'Synthetic' })),
    ).resolves.toMatchObject(FORBIDDEN);
    expect(api.requests).toHaveLength(1);
  });

  it('says why in words when pii:view is missing: the matches are hidden from the operator (owner decision 16)', async () => {
    as('reports:read', 'reports:review');

    await expect(
      dismissReportMatches(null, form({ 'report-id': ID, reason: 'Synthetic' })),
    ).resolves.toEqual({ ok: false, problem: REVIEW_NEEDS_PII_VIEW });
    expect(REVIEW_NEEDS_PII_VIEW).toMatchObject({
      title: 'You do not have access',
      detail:
        'Reviewing or dismissing a match needs pii:view as well as reports:review: without it the matches are hidden from you, and nobody decides on evidence they cannot see. Ask an administrator for a role with both.',
    });
  });

  it('says the same when the API refuses the dismissal for pii:view, keeping its request id (owner decision 16)', async () => {
    as('reports:read', 'reports:review', 'pii:view');
    api.onProblem('POST', `${PAGE}/dismiss`, 403, 'forbidden', {
      detail: 'The user is missing the required permission: pii:view.',
      requestId: 'req_synthetic_403',
    });

    await expect(
      dismissReportMatches(null, form({ 'report-id': ID, reason: 'Synthetic' })),
    ).resolves.toEqual({
      ok: false,
      problem: { ...REVIEW_NEEDS_PII_VIEW, status: 403, requestId: 'req_synthetic_403' },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('titles a refusal in words by its problem code', async () => {
    as('reports:read', 'reports:review', 'pii:view');
    api.onProblem('POST', `${PAGE}/dismiss`, 410, undefined, { code: 'report_redacted' });

    await expect(
      dismissReportMatches(null, form({ 'report-id': ID, reason: 'Synthetic' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { title: REPORT_PROBLEM_WORDS.report_redacted, status: 410 },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('reviewReportMatches (C75.5)', () => {
  it('reviews one match by its record token with a risk level, a comment and notify-on-change', async () => {
    as('reports:read', 'reports:review', 'pii:view');
    api.on('POST', `${PAGE}/review`, 200, single(report('watchlist')));

    await reviewReportMatches(
      null,
      form({
        'report-id': ID,
        'review-type': 'record',
        'record-token': REPORT_IDS.match,
        'review-status': 'true_positive',
        'risk-level': 'material',
        comment: 'Synthetic: the subject is the listed party',
        'notify-on-change': 'true',
      }),
    );

    expect(api.find('POST', `${PAGE}/review`)?.body).toEqual({
      data: {
        attributes: {
          'review-type': 'record',
          'record-token': REPORT_IDS.match,
          'review-status': 'true_positive',
          'risk-level': 'material',
          comment: 'Synthetic: the subject is the listed party',
          'notify-on-change': true,
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
  });

  it('reviews every open match, leaving out an empty risk level', async () => {
    as('reports:read', 'reports:review', 'pii:view');
    api.on('POST', `${PAGE}/review`, 200, single(report('watchlist')));

    await reviewReportMatches(
      null,
      form({
        'report-id': ID,
        'review-type': 'all_records',
        'review-status': 'indeterminate',
        'risk-level': '',
        comment: 'Synthetic: not enough to decide',
      }),
    );

    expect(api.find('POST', `${PAGE}/review`)?.body).toEqual({
      data: {
        attributes: {
          'review-type': 'all_records',
          'review-status': 'indeterminate',
          comment: 'Synthetic: not enough to decide',
          'notify-on-change': false,
        },
      },
    });
  });

  it('requires a comment for every review, the reason kept in the history (C86)', async () => {
    as('reports:read', 'reports:review', 'pii:view');

    await expect(
      reviewReportMatches(
        null,
        form({
          'report-id': ID,
          'review-type': 'all_records',
          'review-status': 'indeterminate',
          comment: ' ',
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        errors: [{ pointer: '/data/attributes/comment', detail: 'Say why you decided this.' }],
      },
    });
    expect(api.find('POST', `${PAGE}/review`)).toBeUndefined();
  });

  it('requires a comment for a false positive, which is a dismissal (C75.5)', async () => {
    as('reports:read', 'reports:review', 'pii:view');

    const result = await reviewReportMatches(
      null,
      form({
        'report-id': ID,
        'review-type': 'record',
        'record-token': REPORT_IDS.match,
        'review-status': 'false_positive',
        comment: '',
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/comment' }] },
    });
    expect(api.find('POST', `${PAGE}/review`)).toBeUndefined();
  });

  it('says a superseded match names the match to review instead (C75.8, V07)', async () => {
    as('reports:read', 'reports:review', 'pii:view');
    api.onProblem('POST', `${PAGE}/review`, 409, undefined, { code: 'report_match_superseded' });

    await expect(
      reviewReportMatches(
        null,
        form({
          'report-id': ID,
          'review-type': 'record',
          'record-token': REPORT_IDS.match,
          'review-status': 'true_positive',
          comment: 'Synthetic: the listed party',
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      problem: { title: REPORT_PROBLEM_WORDS.report_match_superseded },
    });
  });

  it('needs pii:view as well as reports:review', async () => {
    as('reports:read', 'reports:review');

    await expect(
      reviewReportMatches(
        null,
        form({ 'report-id': ID, 'review-type': 'all_records', 'review-status': 'indeterminate' }),
      ),
    ).resolves.toMatchObject(FORBIDDEN);
  });

  it('says why in words when the review is refused for pii:view, by the console or by the API (owner decision 16)', async () => {
    as('reports:read', 'reports:review');
    const fields = {
      'report-id': ID,
      'review-type': 'all_records',
      'review-status': 'indeterminate',
      comment: 'Synthetic',
    };

    await expect(reviewReportMatches(null, form(fields))).resolves.toEqual({
      ok: false,
      problem: REVIEW_NEEDS_PII_VIEW,
    });

    as('reports:read', 'reports:review', 'pii:view');
    api.onProblem('POST', `${PAGE}/review`, 403, 'forbidden', {
      detail: 'The API key is missing the required scope: pii:view.',
    });
    await expect(reviewReportMatches(null, form(fields))).resolves.toMatchObject({
      ok: false,
      problem: { ...REVIEW_NEEDS_PII_VIEW, status: 403 },
    });
  });
});

describe('monitoring: pauseReport, resumeReport, runReport (C74.5)', () => {
  it.each([
    ['pause', pauseReport],
    ['resume', resumeReport],
    ['run', runReport],
  ] as const)('%s runs through the server API and refreshes the page', async (path, action) => {
    as('reports:read', 'reports:write');
    api.on('POST', `${PAGE}/${path}`, 200, single(report('watchlist')));

    await expect(action(null, form({ 'report-id': ID }))).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(api.find('POST', `${PAGE}/${path}`)).toBeDefined();
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
  });

  it('says why there is nothing to pause or resume, in words', async () => {
    as('reports:read', 'reports:write');
    api.onProblem('POST', `${PAGE}/pause`, 409, undefined, { code: 'report_no_scheduled_run' });

    await expect(pauseReport(null, form({ 'report-id': ID }))).resolves.toMatchObject({
      ok: false,
      problem: { title: REPORT_PROBLEM_WORDS.report_no_scheduled_run },
    });
  });

  it('needs reports:write, and a well-formed report id', async () => {
    as('reports:read');
    await expect(runReport(null, form({ 'report-id': ID }))).resolves.toMatchObject(FORBIDDEN);

    as('reports:read', 'reports:write');
    await expect(runReport(null, form({ 'report-id': 'rep_1' }))).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/report-id' }] },
    });
    expect(api.find('POST', `/reports/rep_1/run`)).toBeUndefined();
  });
});

describe('redactReport (C73.5)', () => {
  it('redacts once the operator typed the phrase', async () => {
    as('reports:read', 'reports:redact');
    api.on('DELETE', PAGE, 200, single(report('watchlist')));

    await expect(
      redactReport(null, form({ 'report-id': ID, confirmation: 'redact' })),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.find('DELETE', PAGE)).toBeDefined();
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
  });

  it('refuses without the phrase, or without reports:redact', async () => {
    as('reports:read', 'reports:redact');
    await expect(
      redactReport(null, form({ 'report-id': ID, confirmation: 'yes' })),
    ).resolves.toMatchObject({ ok: false, problem: { errors: [{ pointer: '/confirmation' }] } });

    as('reports:read');
    await expect(
      redactReport(null, form({ 'report-id': ID, confirmation: 'redact' })),
    ).resolves.toMatchObject(FORBIDDEN);
    expect(api.find('DELETE', PAGE)).toBeUndefined();
  });
});

describe('report tags (C72.1)', () => {
  it('adds, removes and sets tags with the shared tag bodies', async () => {
    as('reports:read', 'reports:write');
    api
      .on('POST', `${PAGE}/add-tag`, 200, single(report('watchlist')))
      .on('POST', `${PAGE}/remove-tag`, 200, single(report('watchlist')))
      .on('POST', `${PAGE}/set-tags`, 200, single(report('watchlist')));

    await addReportTag(null, form({ 'report-id': ID, 'tag-name': 'vip' }));
    await removeReportTag(null, form({ 'report-id': ID, 'tag-name': 'onboarding' }));
    await setReportTags(null, form({ 'report-id': ID, 'tag-names': 'vip\nreviewed' }));

    expect(api.find('POST', `${PAGE}/add-tag`)?.body).toEqual({ meta: { 'tag-name': 'vip' } });
    expect(api.find('POST', `${PAGE}/remove-tag`)?.body).toEqual({
      meta: { 'tag-name': 'onboarding' },
    });
    expect(api.find('POST', `${PAGE}/set-tags`)?.body).toEqual({
      meta: { 'tag-names': ['vip', 'reviewed'] },
    });
    expect(revalidatePath).toHaveBeenCalledTimes(3);
  });

  it('says a redacted report keeps its tags, in words (H23)', async () => {
    as('reports:read', 'reports:write');
    api.onProblem('POST', `${PAGE}/add-tag`, 410, undefined, { code: 'report_redacted' });

    await expect(
      addReportTag(null, form({ 'report-id': ID, 'tag-name': 'vip' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { title: REPORT_PROBLEM_WORDS.report_redacted },
    });
  });
});
