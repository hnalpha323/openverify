import {
  GOVERNMENT_ID_EXTRACTION_ATTRIBUTES,
  verificationResourceSchema,
  type VerificationCheck,
} from '@openverify/contracts';
import type { ExtractionSource, Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLayout } from '../../../components/console-layout';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  LIFECYCLE_IDS as IDS,
  T1,
  governmentIdVerification,
  inquiryDocument,
} from '../../../testing/lifecycle-fixtures';
import { expectNotFound, redirectTarget } from '../../../testing/next-errors';
import {
  selfieCapture,
  selfieInquiryDocument,
  selfieVerification,
  supersededCapture,
} from '../../../testing/selfie-fixtures';
import {
  PHASE5_RESOURCE_TYPES,
  phase5File,
  phase5Verification,
  piiValuesOf,
} from '../../../testing/phase5-fixtures';
import { rscPayloadOf } from '../../../testing/rsc-payload';
import VerificationsLayout from '../layout';
import VerificationError from './error';
import VerificationLoading from './loading';
import VerificationPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('../../actions/auth', () => ({ logout: vi.fn() }));
vi.mock('../../actions/environment', () => ({ switchEnvironment: vi.fn() }));

const VERIFICATION = `/verifications/${IDS.governmentId}`;
const INQUIRY = `/dashboard/inquiries/${IDS.inquiry}`;
/** A reviewer: the checks, the inquiry it belongs to, and personal data. */
const REVIEWER: Permission[] = ['verifications:read', 'inquiries:read', 'pii:view'];

const CHECKS: VerificationCheck[] = [
  {
    name: 'id_blur_detection',
    status: 'passed',
    reasons: [],
    requirement: 'required',
    metadata: { blur_score: 212.5, threshold: 10 },
  },
  {
    name: 'id_glare_detection',
    status: 'failed',
    reasons: ['glare_detected'],
    requirement: 'not_required',
    metadata: { glare_ratio: 0.31, regions: [1, 2] },
  },
];

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: REVIEWER });
  api.on('GET', VERIFICATION, 200, {
    data: governmentIdVerification({ status: 'failed', checks: [...CHECKS] }),
  });
  api.on('GET', INQUIRY, 200, inquiryDocument());
});

afterEach(() => {
  api.restore();
  vi.restoreAllMocks();
});

const page = (id: string = IDS.governmentId) =>
  VerificationPage({ params: Promise.resolve({ id }) });

async function renderVerification() {
  render(await page());
}

const region = (name: string) => screen.getByRole('region', { name });

function rowFor(name: string): HTMLElement {
  const row = screen.getByRole('rowheader', { name }).closest('tr');
  if (row === null) throw new Error(`No row for ${name}`);
  return row;
}

const INQUIRIES_READ_NEEDED = 'Your role cannot see these images (the inquiries:read permission).';

/** Both images are "Hidden", each explaining which permission the operator lacks. */
function expectHiddenImages(files: HTMLElement, explanation: string) {
  const hidden = within(files).getAllByText('Hidden', { exact: true });
  expect(hidden).toHaveLength(2);
  for (const value of hidden) {
    expect(value).toHaveAccessibleDescription(explanation);
  }
}

/**
 * Without the inquiry (Workflow 2E E001), the breadcrumb names it but links nothing the operator
 * could not open, and marks only the verification as the current page.
 */
function expectUnlinkedBreadcrumb() {
  const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(breadcrumb).queryByRole('link')).not.toBeInTheDocument();
  expect(within(breadcrumb).getByText('Inquiries')).not.toHaveAttribute('aria-current');
  expect(within(breadcrumb).getByText(IDS.inquiry).closest('[aria-current]')).toBeNull();
  expect(within(breadcrumb).getByText(IDS.governmentId).closest('[aria-current]')).toHaveAttribute(
    'aria-current',
    'page',
  );
}

describe('verification page of a rejected handoff (C96.3, C108, K7C-1)', () => {
  it('marks the verification in words, and changes nothing about its status', async () => {
    api.on('GET', VERIFICATION, 200, {
      data: governmentIdVerification({ 'from-rejected-handoff': true, status: 'passed' }),
    });
    await renderVerification();

    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('From a rejected handoff');
    expect(note).toHaveTextContent(/created on a phone session the desktop rejected/);
    expect(region('Details')).toHaveTextContent('Passed');
  });

  it('marks nothing on a verification no rejected session created', async () => {
    api.on('GET', VERIFICATION, 200, {
      data: governmentIdVerification({ 'from-rejected-handoff': false }),
    });
    await renderVerification();

    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('verification page (C26)', () => {
  it('shows the verification with its type, status, inquiry and times', async () => {
    await renderVerification();

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(`Government ID verification ${IDS.governmentId}`);
    expect(screen.getAllByText('Failed', { selector: '[data-status]' })[0]).toHaveAttribute(
      'data-status',
      'failed',
    );
    const details = region('Details');
    expect(within(details).getByRole('link', { name: IDS.inquiry })).toHaveAttribute(
      'href',
      `/inquiries/${IDS.inquiry}`,
    );
    expect(within(details).getByText('Country').nextElementSibling).toHaveTextContent('US');
    expect(within(details).getByText('ID class').nextElementSibling).toHaveTextContent(
      'drivers_license',
    );
    expect(within(details).getByText('Created (UTC)').nextElementSibling).toHaveTextContent(
      'Oct 20, 2026',
    );
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(breadcrumb).getByRole('link', { name: `Inquiry ${IDS.inquiry}` }),
    ).toHaveAttribute('href', `/inquiries/${IDS.inquiry}`);
  });

  it('lists every check with its status, requirement, reasons and metadata', async () => {
    await renderVerification();

    // The advisory failure stays in view; the passed check is folded away until asked for (C37).
    expect(
      within(region('Checks')).getByRole('table', {
        name: 'Government ID checks needing attention',
      }),
    ).toBeVisible();
    await userEvent.click(within(region('Checks')).getByText('Other checks: 1 passed'));
    const blur = rowFor('id_blur_detection');
    expect(within(blur).getByText('Passed')).toHaveAttribute('data-status', 'passed');
    expect(within(blur).getByText('Required')).toBeVisible();
    expect(within(blur).getByText('None')).toBeVisible();
    expect(within(blur).getByText('blur_score').nextElementSibling).toHaveTextContent('212.5');
    const glare = rowFor('id_glare_detection');
    expect(within(glare).getByText('Advisory')).toBeVisible();
    expect(within(glare).getByText('glare_detected')).toBeVisible();
    expect(within(glare).getByText('glare_ratio').nextElementSibling).toHaveTextContent('0.31');
    expect(within(glare).getByText('regions').nextElementSibling).toHaveTextContent('[1,2]');
  });

  it('says when no check has run yet', async () => {
    api.on('GET', VERIFICATION, 200, {
      data: governmentIdVerification({ status: 'initiated', checks: [] }),
    });

    await renderVerification();

    expect(within(region('Checks')).getByText('No checks have run yet.')).toBeVisible();
  });

  it('shows the images through the file proxy to an operator with pii:view', async () => {
    await renderVerification();

    const files = region('Files');
    expect(within(files).getByRole('img', { name: 'Government ID, front' })).toHaveAttribute(
      'src',
      `/files/${IDS.front}/rendition`,
    );
    expect(within(files).getByRole('img', { name: 'Government ID, back' })).toBeVisible();
    expect(within(files).getByText(IDS.front)).toBeVisible();
  });

  it('shows the images as "Hidden" without pii:view', async () => {
    api.me({ permissions: ['verifications:read', 'inquiries:read'] });

    await renderVerification();

    const files = region('Files');
    expect(within(files).queryByRole('img')).not.toBeInTheDocument();
    expectHiddenImages(files, 'Your role cannot see personal data (the pii:view permission).');
    expect(within(files).getByText('Front')).toBeVisible();
  });

  it('shows what a redaction removed as "Redacted"', async () => {
    api.on('GET', INQUIRY, 200, inquiryDocument({ 'redacted-at': T1 }));
    api.on('GET', VERIFICATION, 200, {
      data: governmentIdVerification({
        checks: CHECKS.map((check) => ({ ...check, reasons: [], metadata: {} })),
      }),
    });

    await renderVerification();

    expect(screen.getByRole('status', { name: 'Redacted' })).toHaveTextContent(
      'The inquiry of this verification was redacted',
    );
    const files = region('Files');
    expect(within(files).queryByRole('img')).not.toBeInTheDocument();
    expect(within(files).getAllByText('Redacted', { exact: true })).toHaveLength(2);
  });

  it('lists the files by ID without inquiries:read, and reads no inquiry', async () => {
    api.me({ permissions: ['verifications:read', 'pii:view'] });

    await renderVerification();

    const files = region('Files');
    expect(within(files).getByText(IDS.front)).toBeVisible();
    expect(within(files).getByText(IDS.back)).toBeVisible();
    // The file content needs inquiries:read as well as pii:view.
    expect(within(files).queryByRole('img')).not.toBeInTheDocument();
    expectHiddenImages(files, INQUIRIES_READ_NEEDED);
    expect(within(region('Details')).queryByRole('link')).not.toBeInTheDocument();
    expect(within(region('Details')).getByText(IDS.inquiry)).toBeVisible();
    expectUnlinkedBreadcrumb();
    expect(api.find('GET', INQUIRY)).toBeUndefined();
  });

  it('names both permissions the images need without inquiries:read or pii:view (Workflow 2E E001)', async () => {
    api.me({ permissions: ['verifications:read'] });

    await renderVerification();

    expectHiddenImages(
      region('Files'),
      'Your role cannot see these images (the inquiries:read and pii:view permissions).',
    );
  });

  it('names inquiries:read in the Files section when the API refuses the inquiry, and links no inquiry (Workflow 2E E001)', async () => {
    api.onProblem('GET', INQUIRY, 403, 'forbidden');

    await renderVerification();

    const files = region('Files');
    // The only forbidden panel is the one in Files, and it names the permission.
    expect(screen.getAllByTestId('forbidden-panel')).toHaveLength(1);
    expect(
      within(files).getByRole('heading', { level: 3, name: 'You do not have access' }),
    ).toBeVisible();
    expect(within(files).getByText('inquiries:read')).toBeVisible();
    expectHiddenImages(files, INQUIRIES_READ_NEEDED);
    expect(within(region('Details')).queryByRole('link')).not.toBeInTheDocument();
    expectUnlinkedBreadcrumb();
  });

  it('says when the verification has no files', async () => {
    api.on('GET', VERIFICATION, 200, {
      data: {
        ...governmentIdVerification(),
        relationships: {
          ...governmentIdVerification().relationships,
          files: { data: [] },
        },
      },
    });

    await renderVerification();

    expect(within(region('Files')).getByText('No files uploaded.')).toBeVisible();
  });

  it('shows the forbidden panel without verifications:read, without reading it', async () => {
    api.me({ permissions: ['inquiries:read'] });

    await renderVerification();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(screen.getByText('verifications:read')).toBeVisible();
    expect(api.find('GET', VERIFICATION)).toBeUndefined();
  });

  it('is not found for a malformed id, without calling the API', async () => {
    await expectNotFound(page('inq_01JB0000000000000000000001'));

    expect(api.requests).toHaveLength(0);
  });

  it('is not found when the API does not show it to this session', async () => {
    api.onProblem('GET', VERIFICATION, 404);

    await expectNotFound(page());
  });

  it('sends the operator to sign in when the session has ended', async () => {
    api.onProblem('GET', VERIFICATION, 401);

    await expect(redirectTarget(page())).resolves.toBe('/login');
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Verification');
  });
});

describe('a selfie verification on its page (C40, C43, C47)', () => {
  const SELFIE = `/verifications/${IDS.selfie}`;

  beforeEach(() => {
    api.on('GET', SELFIE, 200, {
      data: selfieVerification(),
      included: [selfieCapture(), supersededCapture()],
    });
    api.on('GET', INQUIRY, 200, selfieInquiryDocument());
  });

  async function renderSelfie() {
    render(await page(IDS.selfie));
  }

  const termValue = (scope: HTMLElement, term: string) =>
    within(scope).getByText(term, { selector: 'dt' }).nextElementSibling;

  it('asks the API for the selfie’s captures', async () => {
    await renderSelfie();

    expect(api.find('GET', SELFIE)?.query.get('include')).toBe('selfies');
  });

  it('names the capture method and the liveness mode', async () => {
    await renderSelfie();

    expect(termValue(region('Details'), 'Capture method')).toHaveTextContent('Camera');
    expect(termValue(region('Details'), 'Liveness')).toHaveTextContent('Active (head turns)');
  });

  it('shows the photos in prompt order with their file ids, and the ID photo beside the centre with the similarity, threshold and basis', async () => {
    await renderSelfie();

    const files = region('Files');
    expect(
      within(files)
        .getAllByRole('img', { name: /^Selfie, / })
        .map((image) => image.getAttribute('alt')),
    ).toEqual(['Selfie, center', 'Selfie, right', 'Selfie, left']);
    expect(within(files).getByText(IDS.selfieCenter)).toBeVisible();
    const comparison = within(files).getByRole('group', {
      name: 'Compared with the government ID',
    });
    const idPhoto = within(comparison).getByRole('img', {
      name: 'Government ID front, whose portrait was compared',
    });
    expect(idPhoto).toHaveAttribute('src', `/files/${IDS.front}/rendition`);
    // Shown at once on the page, not behind a disclosure.
    expect(idPhoto.closest('details')).toBeNull();
    expect(termValue(comparison, 'Similarity')).toHaveTextContent('0.6512');
    expect(termValue(comparison, 'Threshold')).toHaveTextContent('0.371');
    expect(termValue(comparison, 'Threshold basis')).toHaveTextContent('Calibrated');
  });

  it('shows the scores, what liveness recorded, the prompt timings and the captures', async () => {
    await renderSelfie();

    expect(within(region('Scores')).getByRole('table', { name: 'Selfie scores' })).toBeVisible();
    expect(
      within(region('Liveness')).getByRole('group', { name: 'Selfie liveness' }),
    ).toBeVisible();
    expect(
      within(region('Prompt timings')).getByRole('table', { name: 'Selfie prompt timings' }),
    ).toBeVisible();
    const captures = within(region('Captures')).getByRole('table', { name: 'Selfie captures' });
    expect(
      within(captures)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual(['self_01JB0000000000000000000010', 'self_01JB0000000000000000000011']);
    expect(within(captures).queryByRole('columnheader', { name: 'Verification' })).toBeNull();
  });

  it('keeps the photos in prompt order and the evidence without inquiries:read, the images hidden', async () => {
    api.me({ permissions: ['verifications:read', 'pii:view'] });

    await renderSelfie();

    const files = region('Files');
    expect(within(files).queryByRole('img')).not.toBeInTheDocument();
    expect(
      within(files)
        .getAllByText(/^(Center|Left|Right)$/)
        .map((label) => label.textContent),
    ).toEqual(['Center', 'Right', 'Left']);
    expect(
      within(files).getByRole('group', { name: 'Compared with the government ID' }),
    ).toHaveTextContent('0.6512');
    expect(within(region('Captures')).getAllByRole('rowheader')).toHaveLength(2);
    expect(api.find('GET', INQUIRY)).toBeUndefined();
  });

  it('says when no check has run and the selfie has no capture', async () => {
    api.on('GET', SELFIE, 200, {
      data: selfieVerification({
        status: 'submitted',
        checks: [],
        poses: null,
        'capture-method': null,
        liveness: null,
        'document-similarity-score': null,
        'selfie-similarity-score-left': null,
        'selfie-similarity-score-right': null,
        'liveness-score': null,
      }),
      included: [],
    });

    await renderSelfie();

    expect(within(region('Scores')).getByText('No checks have run yet.')).toBeVisible();
    expect(within(region('Liveness')).getByText('No checks have run yet.')).toBeVisible();
    expect(
      within(region('Prompt timings')).getByText(
        'No capture: this selfie was taken without the capture protocol.',
      ),
    ).toBeVisible();
    expect(within(region('Captures')).getByText('No selfie captures.')).toBeVisible();
  });
});

/** A value no test shows on purpose: it must never reach an operator the API masked it for. */
const SENTINEL = 'SENTINELNAME';

/** The extraction attributes as the API sends them: these values, `null` for the rest. */
function extraction(values: Partial<Record<string, string>>) {
  return Object.fromEntries(
    GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.map((field) => [field, values[field] ?? null]),
  );
}

const READ = {
  'name-first': 'NORA',
  'name-last': 'CALDERWOOD',
  birthdate: '1988-03-21',
  'identification-number': 'UT4829163',
};
const READ_FROM = {
  'name-last': ['mrz', 'viz'],
  birthdate: ['mrz', 'viz'],
} as const satisfies Record<string, readonly ExtractionSource[]>;

describe('the extraction on the verification page (C31.5, C31.6, C37)', () => {
  const extractionRegion = () => region('Extraction');
  const value = (label: string) =>
    within(extractionRegion())
      .getByRole('rowheader', { name: label })
      .closest('tr')
      ?.querySelector('td');

  it('shows every extracted value and its sources to an operator with pii:view', async () => {
    api.on('GET', VERIFICATION, 200, {
      data: governmentIdVerification({ ...extraction(READ), 'extraction-sources': READ_FROM }),
    });

    await renderVerification();

    expect(
      within(extractionRegion())
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toHaveLength(GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.length);
    expect(value('Last name')).toHaveTextContent(/^CALDERWOOD$/);
    expect(value('Date of birth')).toHaveTextContent(/^1988-03-21$/);
    expect(
      within(extractionRegion()).getAllByText('Machine-readable zone, Visual zone'),
    ).toHaveLength(2);
  });

  it('shows the values as "Hidden" to an operator without pii:view, as the API masked them', async () => {
    api.me({ permissions: ['verifications:read', 'inquiries:read'] });
    api.on('GET', VERIFICATION, 200, {
      data: governmentIdVerification({ ...extraction({}), 'extraction-sources': READ_FROM }),
    });

    await renderVerification();

    expect(within(extractionRegion()).getAllByText('Hidden', { exact: true })).toHaveLength(
      GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.length,
    );
  });

  it('shows the values as "Redacted" once the inquiry was redacted', async () => {
    api.on('GET', INQUIRY, 200, inquiryDocument({ 'redacted-at': T1 }));
    api.on('GET', VERIFICATION, 200, {
      data: governmentIdVerification({ ...extraction({}), 'extraction-sources': READ_FROM }),
    });

    await renderVerification();

    expect(within(extractionRegion()).getAllByText('Redacted', { exact: true })).toHaveLength(
      GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.length,
    );
  });

  it('has no extraction for a selfie', async () => {
    api.on('GET', VERIFICATION, 200, {
      data: verificationResourceSchema.parse({
        type: 'verification/selfie',
        id: IDS.governmentId,
        attributes: { status: 'passed', checks: [], 'created-at': T1, 'updated-at': T1 },
        relationships: {
          inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
          files: { data: [] },
        },
      }),
    });

    await renderVerification();

    expect(screen.queryByRole('region', { name: 'Extraction' })).not.toBeInTheDocument();
  });

  it('lets no value the API masked reach the page or the props of a client component from another source', async () => {
    api.me({ permissions: ['verifications:read', 'inquiries:read'] });
    api.on('GET', VERIFICATION, 200, {
      data: governmentIdVerification({ ...extraction({}), 'extraction-sources': READ_FROM }),
    });
    // The inquiry carries the same verification. Were a value to slip into it, the page must
    // still show only what the verification answer says.
    const leaky = inquiryDocument();
    api.on('GET', INQUIRY, 200, {
      ...leaky,
      included: leaky.included.map((resource) =>
        resource.type === 'verification/government-id'
          ? {
              ...resource,
              attributes: {
                ...resource.attributes,
                ...extraction({ ...READ, 'name-last': SENTINEL }),
                'extraction-sources': READ_FROM,
              },
            }
          : resource,
      ),
    });

    const element = await page();
    const payload = await rscPayloadOf(element);
    render(element);

    expect(within(extractionRegion()).getAllByText('Hidden', { exact: true })).toHaveLength(
      GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.length,
    );
    expect(document.body.textContent).not.toContain(SENTINEL);
    expect(payload).not.toContain(SENTINEL);
    expect(payload).not.toContain('NORA');
    expect(payload).not.toContain('1988-03-21');
  });

  it('puts the extracted values in the payload for an operator the API shows them to (the check above can fail)', async () => {
    api.on('GET', VERIFICATION, 200, {
      data: governmentIdVerification({
        ...extraction({ ...READ, 'name-last': SENTINEL }),
        'extraction-sources': READ_FROM,
      }),
    });

    await expect(rscPayloadOf(await page())).resolves.toContain(SENTINEL);
  });
});

describe('a Phase 5 verification on its page (C54.5)', () => {
  const PDF = 'file_01JB0000000000000000000020';
  const PREVIEW = 'file_01JB0000000000000000000021';

  /** The verification as the API answers for it, with the inquiry's document carrying `seen`. */
  function serve(
    answer: ReturnType<typeof phase5Verification>,
    seen: ReturnType<typeof phase5Verification> = answer,
    files: ReturnType<typeof phase5File>[] = [],
  ) {
    api.on('GET', VERIFICATION, 200, { data: answer });
    const inquiry = inquiryDocument();
    api.on('GET', INQUIRY, 200, {
      ...inquiry,
      included: [
        ...inquiry.included.filter((resource) => resource.id !== IDS.governmentId),
        seen,
        ...files,
      ],
    });
  }

  it.each(PHASE5_RESOURCE_TYPES)('shows a %s verification with its evidence', async (type) => {
    serve(phase5Verification(type, { id: IDS.governmentId }));

    await renderVerification();

    const evidence = region('Evidence');
    expect(within(evidence).getByRole('group')).toHaveAccessibleName(/ evidence$/);
    expect(region('Checks')).toBeVisible();
    for (const value of piiValuesOf(type)) {
      expect(evidence).toHaveTextContent(value);
    }
  });

  // Workflow 5C review P024: the evidence's part titles are headings one below the page's h2.
  it('titles a chip verification’s evidence parts with level 3 headings, under its Evidence heading', async () => {
    serve(phase5Verification('verification/government-id-nfc', { id: IDS.governmentId }));

    await renderVerification();

    const evidence = within(region('Evidence')).getByRole('group');
    expect(within(evidence).getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);
    expect(within(evidence).queryAllByRole('heading', { level: 5 })).toEqual([]);
  });

  it.each(PHASE5_RESOURCE_TYPES)(
    'lets no %s value the API masked reach the page or the props of a client component from another source',
    async (type) => {
      api.me({ permissions: ['verifications:read', 'inquiries:read'] });
      // The inquiry carries the same verification unmasked. Were a value to slip into it, the
      // page must still show only what the verification answer says.
      serve(
        phase5Verification(type, { id: IDS.governmentId, masked: true }),
        phase5Verification(type, { id: IDS.governmentId }),
      );

      const element = await page();
      const payload = await rscPayloadOf(element);
      render(element);

      expect(
        within(region('Evidence')).getAllByText('Hidden', { exact: true }).length,
      ).toBeGreaterThan(0);
      const values = piiValuesOf(type);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(document.body.textContent).not.toContain(value);
        expect(payload).not.toContain(value);
      }
    },
  );

  it.each(PHASE5_RESOURCE_TYPES)(
    'puts the %s values in the payload for an operator the API shows them to (the check above can fail)',
    async (type) => {
      serve(phase5Verification(type, { id: IDS.governmentId }));

      const payload = await rscPayloadOf(await page());

      for (const value of piiValuesOf(type)) {
        expect(payload).toContain(value);
      }
    },
  );

  it('shows "Redacted" for the personal values once the inquiry was redacted', async () => {
    const answer = phase5Verification('verification/database', {
      id: IDS.governmentId,
      masked: true,
    });
    api.on('GET', VERIFICATION, 200, { data: answer });
    const redacted = inquiryDocument({ 'redacted-at': T1 });
    api.on('GET', INQUIRY, 200, {
      ...redacted,
      included: [
        ...redacted.included.filter((resource) => resource.id !== IDS.governmentId),
        answer,
      ],
    });

    await renderVerification();

    expect(within(region('Evidence')).getByText('Name first').nextElementSibling).toHaveTextContent(
      /^Redacted$/,
    );
  });

  // Workflow 6B P5-2: the preview the evidence shows is named in the files, not shown again.
  it('lists a file that is not an image by its kind and ID, and names the preview the evidence shows', async () => {
    const verification = phase5Verification('verification/document', {
      id: IDS.governmentId,
      fileIds: [PDF, PREVIEW],
    });
    serve(verification, verification, [
      phase5File(PDF, 'document', 'application/pdf', verification),
      phase5File(PREVIEW, 'document-preview', 'image/png', verification),
    ]);

    await renderVerification();

    const files = within(region('Files')).getByRole('list', { name: 'Document files' });
    expect(within(files).queryAllByRole('img')).toEqual([]);
    const [pdf, preview] = within(files).getAllByRole('listitem');
    expect(pdf).toHaveTextContent('Document');
    expect(pdf).toHaveTextContent(PDF);
    expect(pdf).toHaveTextContent('application/pdf');
    expect(preview).toHaveTextContent('Document preview');
    expect(preview).toHaveTextContent(PREVIEW);
    expect(preview).toHaveTextContent('Shown with the evidence');
  });
});

describe('verification section', () => {
  it('is in the console layout', () => {
    expect(VerificationsLayout).toBe(ConsoleLayout);
  });

  it('announces its loading state', () => {
    render(<VerificationLoading />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading the verification…');
  });

  it('explains a failure without internals and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<VerificationError error={new Error('socket hang up')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The verification could not be loaded.');
    expect(screen.queryByText(/socket/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
