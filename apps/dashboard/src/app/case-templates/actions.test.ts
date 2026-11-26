// @vitest-environment node
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CASE_PROBLEM_WORDS, TRANSITION_MAP_WORDS } from '../../components/cases/case-words';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import {
  CASE_FIELD_SCHEMAS,
  CASE_IDS,
  CASE_STATUSES,
  caseTemplate,
  caseTemplateVersion,
} from '../../testing/cases-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import { CASE_DEVELOPER, CASE_REVIEWER } from '../../testing/routes/cases';
import {
  archiveCaseTemplate,
  createCaseTemplate,
  createCaseTemplateDraft,
  publishCaseTemplateDraft,
  updateCaseTemplate,
  updateCaseTemplateDraft,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const TEMPLATE = `/case-templates/${CASE_IDS.template}`;
const DRAFT = `/case-template-versions/${CASE_IDS.draft}`;
let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: CASE_DEVELOPER });
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string | readonly string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const each of typeof value === 'string' ? [value] : value) {
      data.append(name, each);
    }
  }
  return data;
};
const ids = { 'case-template-id': CASE_IDS.template, 'version-id': CASE_IDS.draft };

/** A draft form as the editor posts it. */
const draftForm = (overrides: Record<string, string | readonly string[]> = {}) =>
  form({
    ...ids,
    'field-schemas': JSON.stringify(CASE_FIELD_SCHEMAS),
    statuses: JSON.stringify(CASE_STATUSES),
    transition: ['open>pending', 'pending>approved', 'pending>declined', 'gone>open'],
    resolutions: 'Approved\n\nDeclined\n',
    'default-queue-id': CASE_IDS.queue,
    'assignment-policy-id': '',
    'sla-policy-id': CASE_IDS.slaPolicy,
    'sla-starts-on': 'assigned',
    'held-object-types': ['inquiry', 'report'],
    'attachment-max-files': '5',
    'attachment-types': ['pdf', 'png'],
    'notify-on-create': `${CASE_IDS.member}\n`,
    'layout-modules': ['timeline', 'comments'],
    'module-permissions:timeline': 'cases:read',
    ...overrides,
  });

describe('case template actions (C130, C142.1)', () => {
  it('creates a template by name and key, and answers its id', async () => {
    api.on('POST', '/case-templates', 201, { data: caseTemplate({ publishedVersion: null }) });

    const result = await createCaseTemplate(
      null,
      form({
        name: ' Synthetic KYC review ',
        key: 'KYC',
        'environment-id': ENVIRONMENTS.sandbox.id,
      }),
    );

    expect(result).toEqual({ ok: true, data: { id: CASE_IDS.template } });
    expect(api.find('POST', '/case-templates')?.body).toEqual({
      data: { type: 'case-template', attributes: { name: 'Synthetic KYC review', key: 'KYC' } },
    });
  });

  it('says in words that a key is taken, and refuses a malformed key without asking the API', async () => {
    api.onProblem('POST', '/case-templates', 409, undefined, { code: 'case_template_key_taken' });
    const taken = await createCaseTemplate(
      null,
      form({ name: 'Synthetic', key: 'KYC', 'environment-id': ENVIRONMENTS.sandbox.id }),
    );
    expect(taken).toMatchObject({
      ok: false,
      problem: { title: CASE_PROBLEM_WORDS.case_template_key_taken },
    });

    const malformed = await createCaseTemplate(
      null,
      form({ name: 'Synthetic', key: 'kyc', 'environment-id': ENVIRONMENTS.sandbox.id }),
    );
    expect(malformed).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/key' }] },
    });
    expect(api.all('POST', '/case-templates')).toHaveLength(1);
  });

  it('renames a template and sets the roles that see its cases', async () => {
    api.on('PATCH', TEMPLATE, 200, { data: caseTemplate() });

    const result = await updateCaseTemplate(
      null,
      form({
        'case-template-id': CASE_IDS.template,
        name: 'Renamed',
        'visible-to-roles': ` ${CASE_IDS.role}, `,
      }),
    );

    expect(result.ok).toBe(true);
    expect(api.find('PATCH', TEMPLATE)?.body).toEqual({
      data: {
        type: 'case-template',
        attributes: { name: 'Renamed', 'visible-to-roles': [CASE_IDS.role] },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(TEMPLATE);
  });

  it('archives a template, and makes a new draft answering its id', async () => {
    api.on('POST', `${TEMPLATE}/archive`, 200, { data: caseTemplate({ status: 'archived' }) });
    api.on('POST', '/case-template-versions', 201, {
      data: caseTemplateVersion({ status: 'draft' }),
    });

    expect(
      await archiveCaseTemplate(null, form({ 'case-template-id': CASE_IDS.template })),
    ).toEqual({ ok: true, data: undefined });
    expect(
      await createCaseTemplateDraft(null, form({ 'case-template-id': CASE_IDS.template })),
    ).toEqual({ ok: true, data: { id: CASE_IDS.draft } });
    expect(api.find('POST', '/case-template-versions')?.body).toEqual({
      data: {
        type: 'case-template-version',
        attributes: { 'case-template-id': CASE_IDS.template },
      },
    });
  });

  it('saves a draft: the moves of the grid for the statuses sent, resolutions by line, and every member', async () => {
    api.on('PATCH', DRAFT, 200, { data: caseTemplateVersion({ status: 'draft' }) });

    const result = await updateCaseTemplateDraft(null, draftForm());

    expect(result.ok).toBe(true);
    expect(api.find('PATCH', DRAFT)?.body).toEqual({
      data: {
        type: 'case-template-version',
        attributes: {
          'field-schemas': CASE_FIELD_SCHEMAS,
          statuses: CASE_STATUSES,
          transitions: {
            open: ['pending'],
            pending: ['approved', 'declined'],
            approved: [],
            declined: [],
          },
          resolutions: ['Approved', 'Declined'],
          'default-queue-id': CASE_IDS.queue,
          'assignment-policy-id': null,
          'sla-policy-id': CASE_IDS.slaPolicy,
          'sla-starts-on': 'assigned',
          'held-object-types': ['inquiry', 'report'],
          'attachment-policy': { 'max-files': 5, types: ['pdf', 'png'] },
          'notify-on-create': [CASE_IDS.member],
          'layout-modules': [
            { key: 'timeline', 'required-permissions': ['cases:read'] },
            { key: 'comments', 'required-permissions': [] },
          ],
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`${TEMPLATE}/versions/${CASE_IDS.draft}`);
  });

  it('refuses a file or JSON field in words at its place, and a document that is not JSON, without asking the API', async () => {
    const file = await updateCaseTemplateDraft(
      null,
      draftForm({
        'field-schemas': JSON.stringify([
          { type: 'string', key: 'note', label: 'Note' },
          { type: 'file', key: 'scan', label: 'Scan' },
        ]),
      }),
    );
    expect(file).toMatchObject({
      ok: false,
      problem: {
        errors: [
          {
            pointer: '/data/attributes/field-schemas/1/type',
            detail: expect.stringMatching(
              /never a file \(attachments carry files\) or JSON/u,
            ) as unknown,
          },
        ],
      },
    });

    const broken = await updateCaseTemplateDraft(null, draftForm({ statuses: '[{' }));
    expect(broken).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/statuses', detail: 'is not valid JSON' }] },
    });
    expect(api.find('PATCH', DRAFT)).toBeUndefined();
  });

  it('publishes a draft, and says every publish problem in words at its place', async () => {
    api.onProblem('POST', `${DRAFT}/publish`, 422, undefined, {
      title: 'Unprocessable Content',
      detail: 'This version cannot be published.',
      errors: [
        {
          pointer: '/data/attributes/statuses/3',
          detail: 'The statuses and their map cannot be published.',
          code: 'end_status_unreachable',
        },
        {
          pointer: '/data/attributes/field-schemas/0/type',
          detail: 'A field key keeps its type across versions (C130.3).',
          code: 'field_type_changed',
        },
        {
          pointer: '/data/attributes/notify-on-create/0',
          detail: 'Names nobody of this organisation who reads this template’s cases.',
        },
      ],
    });

    const result = await publishCaseTemplateDraft(null, form(ids));

    expect(result).toEqual({
      ok: false,
      problem: expect.objectContaining({
        title: 'This version cannot be published',
        errors: [
          {
            pointer: '/data/attributes/statuses/3',
            detail: `Status 4: ${TRANSITION_MAP_WORDS.end_status_unreachable}`,
          },
          {
            pointer: '/data/attributes/field-schemas/0/type',
            detail: 'Field 1: A field key keeps its type in every version of a template.',
          },
          {
            pointer: '/data/attributes/notify-on-create/0',
            detail:
              'Told of a new case, entry 1: Names nobody of this organisation who reads this template’s cases.',
          },
        ],
      }) as unknown,
    });

    api.on('POST', `${DRAFT}/publish`, 200, { data: caseTemplateVersion() });
    expect(await publishCaseTemplateDraft(null, form(ids))).toEqual({ ok: true, data: undefined });
    expect(revalidatePath).toHaveBeenCalledWith(TEMPLATE);
  });

  it('places a layout module problem at the module, 1-based, named by its key when the draft says it (K9-17)', async () => {
    const problems = {
      title: 'Unprocessable Content',
      detail: 'This version cannot be published.',
      errors: [
        {
          pointer: '/data/attributes/layout/modules/1/key',
          detail: 'The version’s layout-modules do not offer it.',
          code: 'layout_module_unknown',
        },
        {
          pointer: '/data/attributes/layout/modules/0/key',
          detail: 'You do not hold the permissions this module needs, so you cannot lay it out.',
          code: 'layout_module_not_permitted',
        },
      ],
    };
    api.onProblem('POST', `${DRAFT}/publish`, 422, undefined, problems);
    const draft = caseTemplateVersion({ status: 'draft' });
    api.on('GET', DRAFT, 200, {
      data: {
        ...draft,
        attributes: {
          ...draft.attributes,
          layout: {
            columns: 2,
            modules: [
              { key: 'graph', column: 1, order: 0, collapsed: false },
              { key: 'signals', column: 2, order: 0, collapsed: false },
            ],
          },
        },
      },
    });

    const result = await publishCaseTemplateDraft(null, form(ids));

    expect(result).toMatchObject({
      ok: false,
      problem: {
        errors: [
          {
            pointer: '/data/attributes/layout/modules/1/key',
            detail: 'Layout module 2 (Signals): The version’s layout-modules do not offer it.',
          },
          {
            pointer: '/data/attributes/layout/modules/0/key',
            detail:
              'Layout module 1 (Graph): You do not hold the permissions this module needs, so you cannot lay it out.',
          },
        ],
      },
    });
  });

  it('places a layout module problem by its position alone when the draft cannot be read (K9-17)', async () => {
    api.onProblem('POST', `${DRAFT}/publish`, 422, undefined, {
      title: 'Unprocessable Content',
      errors: [
        {
          pointer: '/data/attributes/layout/modules/2/key',
          detail: 'The version’s layout-modules do not offer it.',
          code: 'layout_module_unknown',
        },
      ],
    });
    api.onProblem('GET', DRAFT, 503);

    expect(await publishCaseTemplateDraft(null, form(ids))).toMatchObject({
      ok: false,
      problem: {
        errors: [
          {
            pointer: '/data/attributes/layout/modules/2/key',
            detail: 'Layout module 3: The version’s layout-modules do not offer it.',
          },
        ],
      },
    });
  });

  it('asks nothing of the API without case-templates:write or case-templates:publish', async () => {
    api.me({ permissions: CASE_REVIEWER });

    expect(await updateCaseTemplateDraft(null, draftForm())).toMatchObject({
      ok: false,
      problem: { title: 'You do not have access' },
    });
    expect(await publishCaseTemplateDraft(null, form(ids))).toMatchObject({ ok: false });
    expect(api.requests.filter((request) => request.method !== 'GET')).toEqual([]);
  });
});
