import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import {
  CASE_FILENAME,
  CASE_IDS,
  CASE_NOTE_VALUE,
  caseExport,
  caseQueue,
  caseResource,
  caseTemplate,
  caseTemplateVersion,
} from '../../testing/cases-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import { rscPayloadOf } from '../../testing/rsc-payload';
import {
  CASE_ADMIN,
  CASE_DEVELOPER,
  serveAssignmentPolicies,
  serveCaseExports,
  serveCaseQueues,
  serveCaseTemplate,
  serveCaseTemplates,
  serveCaseTemplateVersion,
  serveCaseTemplateVersions,
  serveCases,
  serveSlaPolicies,
} from '../../testing/routes/cases';
import CaseTemplatePage from '../case-templates/[id]/page';
import CaseTemplateVersionPage from '../case-templates/[id]/versions/[versionId]/page';
import CaseTemplatesPage from '../case-templates/page';
import CaseExportsPage from './exports/page';
import CasesPage from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveCaseTemplates(api, [caseTemplate({ draftVersion: 2 })]);
  serveCaseQueues(api, [caseQueue()]);
});

afterEach(() => {
  api.restore();
});

const params = Promise.resolve({});

/** A case as the API serves it to a principal without `pii:view` (C136.4, C135): masked. */
const masked = () =>
  caseResource({
    fields: { note: { type: 'string', value: null } },
    attachmentFilename: null,
  });

/** The same case served to a principal with `pii:view`: the values are in the API's answer. */
const unmasked = () =>
  caseResource({
    id: CASE_IDS.otherCase,
    name: 'KYC-7',
    attachmentFilename: CASE_FILENAME,
  });

describe('the case console’s RSC payload (C142.1, P38)', () => {
  it('carries no field value and no filename on the case list, for a principal without pii:view', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveCases(api, [masked()]);

    const payload = await rscPayloadOf(await CasesPage({ searchParams: params }));

    expect(payload).toContain('KYC-6');
    expect(payload).not.toContain(CASE_NOTE_VALUE);
    expect(payload).not.toContain(CASE_FILENAME);
  });

  it('carries no field value and no filename on the case list even when the API answered them, because the list names neither', async () => {
    api.me({ permissions: CASE_ADMIN });
    serveCases(api, [unmasked()]);

    const payload = await rscPayloadOf(await CasesPage({ searchParams: params }));

    expect(payload).toContain('KYC-7');
    expect(payload).not.toContain(CASE_NOTE_VALUE);
    expect(payload).not.toContain(CASE_FILENAME);
    expect(payload).not.toContain('"fields"');
  });

  it('carries no subject value on the template pages, which hold configuration only', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveCaseTemplate(api, caseTemplate({ draftVersion: 2 }));
    serveCaseTemplateVersions(api, [
      caseTemplateVersion({ status: 'draft' }),
      caseTemplateVersion(),
    ]);
    serveCaseTemplateVersion(api, caseTemplateVersion());
    serveCaseTemplateVersion(api, caseTemplateVersion({ status: 'draft' }));
    serveAssignmentPolicies(api, []);
    serveSlaPolicies(api, []);

    const payloads = [
      await rscPayloadOf(await CaseTemplatesPage({ searchParams: params })),
      await rscPayloadOf(
        await CaseTemplatePage({
          params: Promise.resolve({ id: CASE_IDS.template }),
          searchParams: params,
        }),
      ),
      await rscPayloadOf(
        await CaseTemplateVersionPage({
          params: Promise.resolve({ id: CASE_IDS.template, versionId: CASE_IDS.draft }),
        }),
      ),
    ];

    for (const payload of payloads) {
      expect(payload).toContain('Synthetic KYC review');
      expect(payload).not.toContain(CASE_NOTE_VALUE);
      expect(payload).not.toContain(CASE_FILENAME);
    }
  });

  it('carries no field value, no filename and no filter on the exports page', async () => {
    api.me({ permissions: [...CASE_DEVELOPER, 'cases:export'] });
    serveCaseExports(api, [
      caseExport(),
      caseExport({ id: CASE_IDS.otherExport, status: 'running' }),
    ]);

    const payload = await rscPayloadOf(await CaseExportsPage({ searchParams: params }));

    expect(payload).toContain(CASE_IDS.export);
    expect(payload).not.toContain(CASE_NOTE_VALUE);
    expect(payload).not.toContain(CASE_FILENAME);
    expect(payload).not.toContain('"filter"');
  });
});
