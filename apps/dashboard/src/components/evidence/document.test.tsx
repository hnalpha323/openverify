/**
 * C60, C66: the document evidence on its card and page: what a pass means; the class with its
 * confidence (uncalibrated, beta) and probabilities; the extracted fields ("Hidden" without
 * `pii:view`, "Redacted" after a redaction, C53.7); the dates; the comparisons; the fabrication
 * score with every component in words (advisory, beta); the page-1 preview through the file route
 * and the original PDF as a download only. Every value comes from the verification answer alone.
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VerificationPage from '../../app/verifications/[id]/page';
import type { DocumentEvidenceProps } from '../../lib/document-evidence';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { DOCUMENT_IDS, documentFiles, documentVerification } from '../../testing/fixtures/document';
import { piiValuesOf } from '../../testing/phase5-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import {
  DOCUMENTS_REVIEWER,
  DOCUMENTS_VIEWER,
  serveDocumentsVerification,
} from '../../testing/routes/documents';
import { DocumentEvidence } from './document';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

function show(props: Partial<DocumentEvidenceProps> = {}) {
  return render(
    <DocumentEvidence
      verification={documentVerification()}
      label="Document"
      state="visible"
      {...props}
    />,
  );
}

const group = () => screen.getByRole('group', { name: 'Document evidence' });

/** The `<dd>` beside a `<dt>` of `scope`. */
function term(scope: HTMLElement, name: string): HTMLElement {
  const dd = within(scope).getByText(name, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`No value for ${name}`);
  return dd;
}

/** The row a row header names, in `table`. */
function row(table: HTMLElement, name: string | RegExp): HTMLElement {
  const found = within(table).getByRole('rowheader', { name }).closest('tr');
  if (found === null) throw new Error(`No row ${String(name)}`);
  return found;
}

const cells = (tableRow: HTMLElement) =>
  within(tableRow)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

describe('DocumentEvidence (C60, C66)', () => {
  it('is one group named after the verification, saying what a pass means and what it does not', () => {
    const { container } = show();

    expect(group()).toHaveTextContent(/What a pass means/);
    expect(group()).toHaveTextContent(/recent document of an accepted type/);
    expect(group()).toHaveTextContent(/does not mean the document is genuine/);
    // The page finds the evidence as the one group of its Evidence region.
    expect(within(container).getAllByRole('group')).toHaveLength(1);
  });

  // Workflow 5C review P024 (WCAG 1.3.1): each part's title is a heading one below the section
  // holding the evidence, so its terms have their context and a reader can move between parts.
  it('titles each part with a heading at the level the host gives, still one group', () => {
    const { container, unmount } = show({ partHeadingLevel: 3 });
    expect(
      within(group())
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Class', 'Extracted fields', 'Dates', 'Comparisons', 'Fabrication (a heuristic)']);
    expect(within(container).getAllByRole('group')).toHaveLength(1);
    unmount();

    show({ partHeadingLevel: 5 });
    expect(within(group()).getAllByRole('heading', { level: 5 })).toHaveLength(5);
  });

  it('shows the class, its uncalibrated confidence as a beta result, and the type check', () => {
    show();

    expect(term(group(), 'Class')).toHaveTextContent(/^Utility bill$/);
    expect(term(group(), 'Type check')).toHaveTextContent('Passed');
    expect(term(group(), 'Type check')).toHaveTextContent('Required');
    const confidence = term(group(), 'Confidence');
    expect(confidence).toHaveTextContent('0.9999');
    expect(confidence).toHaveTextContent('Beta');
    expect(confidence).toHaveTextContent(/uncalibrated/);
    expect(term(group(), 'Minimum confidence')).toHaveTextContent(/^0\.50$/);
    expect(term(group(), 'Language')).toHaveTextContent(/^English$/);
    expect(term(group(), 'Accepted classes')).toHaveTextContent('Utility bill, Bank statement');
    expect(term(group(), 'Pages')).toHaveTextContent(/^2$/);
    expect(term(group(), 'Media type')).toHaveTextContent(/^application\/pdf$/);
  });

  it('lists the class probabilities, highest first', () => {
    show();

    const table = within(group()).getByRole('table', { name: 'Document class probabilities' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Class', 'Probability']);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual([
      'Utility bill',
      'Another kind of document',
      'Bank statement',
      'Lease or rental agreement',
      'Pay stub',
      'Tax document',
    ]);
    expect(cells(row(table, 'Utility bill'))).toEqual(['0.9999']);
  });

  it('never shows an unrecognised document as a pass, and says why and that it goes to review', () => {
    show({
      verification: documentVerification({
        status: 'needs_review',
        attributes: { 'document-type': 'unknown', 'document-type-confidence': 0.39 },
        checks: {
          document_type_detection: {
            status: 'not_applicable',
            reasons: ['document_type_unknown'],
            metadata: {
              classification: 'unknown',
              language: 'es',
              script: 'latin',
              'identity-document': false,
              features: ['money-column'],
              'accepted-types': ['utility_bill'],
              'unknown-reason': 'confidence',
            },
          },
        },
      }),
    });

    expect(term(group(), 'Class')).toHaveTextContent(/^Not recognised$/);
    const typeCheck = term(group(), 'Type check');
    expect(typeCheck).toHaveTextContent('Not applicable');
    expect(typeCheck).not.toHaveTextContent('Passed');
    expect(typeCheck).toHaveTextContent('Document not recognised');
    expect(term(group(), 'Why not recognised')).toHaveTextContent(
      'The top class was below the minimum confidence',
    );
    expect(term(group(), 'Layout features')).toHaveTextContent('A column of amounts');
  });

  it('shows each extracted field as the API sent it', () => {
    show();

    expect(term(group(), 'Name')).toHaveTextContent(/^QUINN VALEMONT$/);
    expect(term(group(), 'Street address')).toHaveTextContent(/^14 LANTERN ROW$/);
    expect(term(group(), 'Street address, line 2')).toHaveTextContent('None');
    expect(term(group(), 'Issue date')).toHaveTextContent(/^2026-09-30$/);
    expect(term(group(), 'Issuer')).toHaveTextContent(/^UTOPIA WATER BOARD$/);
  });

  it('shows the fields the API masked as "Hidden", and nothing of their values', () => {
    show({ verification: documentVerification({ masked: true }), state: 'hidden' });

    expect(within(term(group(), 'Name')).getByText('Hidden')).toHaveAccessibleDescription(
      'Your role cannot see personal data (the pii:view permission).',
    );
    expect(within(group()).getAllByText('Hidden', { exact: true })).toHaveLength(10);
    for (const value of piiValuesOf('verification/document')) {
      expect(group()).not.toHaveTextContent(value);
    }
    // The class is not personal data.
    expect(term(group(), 'Class')).toHaveTextContent('Utility bill');
  });

  it('shows "Redacted" once a redaction removed the fields, and says when none were read', () => {
    const { unmount } = show({
      verification: documentVerification({ attributes: { fields: null } }),
      state: 'redacted',
    });
    expect(term(group(), 'Extracted fields')).toHaveTextContent(/^Redacted$/);
    unmount();

    show({ verification: documentVerification({ attributes: { fields: null } }) });
    expect(term(group(), 'Extracted fields')).toHaveTextContent('No fields were extracted');
  });

  it('shows the recency window, where the issue date was read, and the expiry in words', () => {
    show();

    const recency = term(group(), 'Recency');
    expect(recency).toHaveTextContent('Passed');
    expect(recency).toHaveTextContent('Within 90 days');
    expect(term(group(), 'Issue date read from')).toHaveTextContent('A labelled issue date');
    const expiry = term(group(), 'Expiry');
    expect(expiry).toHaveTextContent('Not applicable');
    expect(expiry).toHaveTextContent('Prints no expiry');
  });

  it('never shows recency without a usable issue date as a pass, and says why', () => {
    show({
      verification: documentVerification({
        checks: {
          document_recency_detection: {
            status: 'not_applicable',
            reasons: ['input_missing'],
            metadata: {
              'document-class': 'utility_bill',
              'date-source': null,
              flags: ['no-issue-date'],
            },
          },
        },
      }),
    });

    const recency = term(group(), 'Recency');
    expect(recency).toHaveTextContent('Not applicable');
    expect(recency).not.toHaveTextContent('Passed');
    expect(recency).toHaveTextContent('Not enough read to judge');
    expect(term(group(), 'Issue date read from')).toHaveTextContent('Not recorded');
    expect(term(group(), 'Date notes')).toHaveTextContent('No issue date was read');
  });

  it('shows the comparisons, with the reference and whether each is required', () => {
    show();

    const name = term(group(), 'Name comparison');
    expect(name).toHaveTextContent('Passed');
    expect(name).toHaveTextContent('Full match');
    expect(name).toHaveTextContent('The inquiry’s fields');
    expect(name).toHaveTextContent('Required');
    expect(term(group(), 'Address comparison')).toHaveTextContent('Advisory');
  });

  it('shows the fabrication result as advisory and beta, with its score, limit and cap', () => {
    show();

    const result = term(group(), 'Fabrication');
    expect(result).toHaveTextContent('Failed');
    expect(result).toHaveTextContent('Advisory: it does not decide the verification');
    expect(result).toHaveTextContent('Beta');
    expect(result).toHaveTextContent('Hidden or covered text');
    expect(term(group(), 'Score')).toHaveTextContent(/^0\.70$/);
    expect(term(group(), 'Fails above')).toHaveTextContent(/^0\.50$/);
    expect(term(group(), 'Weak cues count at most')).toHaveTextContent(/^0\.45$/);
    expect(term(group(), 'Fabrication confidence')).toHaveTextContent(/^0\.40$/);
    expect(group()).toHaveTextContent(/A clean score is no proof that a document is genuine/);
  });

  it('lists every fabrication component with its strength, weight, signal and contribution', () => {
    show();

    const table = within(group()).getByRole('table', { name: 'Document fabrication cues' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Cue', 'Strength', 'Weight', 'Signal', 'Contribution']);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(11);
    const hidden = row(table, /^Hidden or covered text over a field/);
    expect(cells(hidden)).toEqual(['Strong', '0.70', '1.00', '0.70']);
    expect(hidden).toHaveTextContent('covered or painted in the background’s colour');
    expect(cells(row(table, /^Editor as producer/))).toEqual(['Weak', '0.20', 'Not seen', '0.00']);
  });

  it('never shows a fabrication check that measured no medium or strong cue as a pass', () => {
    show({
      verification: documentVerification({
        checks: {
          document_fabrication_detection: {
            status: 'not_applicable',
            reasons: ['input_missing'],
            confidence: null,
          },
        },
      }),
    });

    const result = term(group(), 'Fabrication');
    expect(result).toHaveTextContent('Not applicable');
    expect(result).not.toHaveTextContent('Passed');
    expect(result).toHaveTextContent('Not enough read to judge');
  });

  it('says when a check did not run', () => {
    show({
      verification: documentVerification({
        checks: { document_fabrication_detection: null, document_address_comparison: null },
      }),
    });

    expect(term(group(), 'Fabrication')).toHaveTextContent('Not run');
    expect(term(group(), 'Address comparison')).toHaveTextContent('Not run');
    expect(within(group()).queryByRole('table', { name: 'Document fabrication cues' })).toBeNull();
  });

  it('shows the page-1 preview through the file route, and the original PDF as a download only', () => {
    show({ files: documentFiles(), media: 'visible' });

    const preview = within(group()).getByRole('img', { name: 'Document preview, page 1' });
    expect(preview).toHaveAttribute('src', `/files/${DOCUMENT_IDS.preview}/rendition`);
    const download = within(group()).getByRole('link', { name: 'Download the original PDF' });
    expect(download).toHaveAttribute('href', `/files/${DOCUMENT_IDS.original}/content`);
    expect(download).toHaveAttribute('download');
    expect(group()).toHaveTextContent(/never opens it in the browser/);
  });

  it('offers no download of a photo, which the files section shows', () => {
    show({ files: documentFiles(undefined, 'image/jpeg'), media: 'visible' });

    expect(within(group()).queryByRole('link')).toBeNull();
    expect(group()).toHaveTextContent(/The original photo is shown with the files/);
  });

  it('shows the preview and the original as "Hidden" or "Redacted" when they cannot be shown', () => {
    const { unmount } = show({ files: documentFiles(), media: 'hidden', state: 'hidden' });
    expect(within(group()).queryByRole('img')).toBeNull();
    expect(within(group()).queryByRole('link')).toBeNull();
    expect(term(group(), 'Preview')).toHaveTextContent('Hidden');
    expect(term(group(), 'Original')).toHaveTextContent('Hidden');
    unmount();

    show({ files: documentFiles(), media: 'redacted', state: 'redacted' });
    expect(term(group(), 'Preview')).toHaveTextContent('Redacted');
    expect(term(group(), 'Original')).toHaveTextContent('Redacted');
  });

  it('says when no preview was stored', () => {
    show({ files: documentFiles().filter((file) => file.attributes.kind === 'document') });

    expect(term(group(), 'Preview')).toHaveTextContent('No preview was stored');
  });

  it('leaves the files to the files section when it is given none', () => {
    show();

    expect(within(group()).queryByRole('img')).toBeNull();
    expect(within(group()).queryByText('Preview', { selector: 'dt' })).toBeNull();
  });
});

describe('a document verification on its page (C66)', () => {
  let api: RouteApi;

  beforeEach(() => {
    fakeRequest.reset();
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api = routeApi();
  });

  afterEach(() => {
    api.restore();
    vi.restoreAllMocks();
  });

  const page = () =>
    VerificationPage({ params: Promise.resolve({ id: DOCUMENT_IDS.verification }) });
  const region = (name: string) => screen.getByRole('region', { name });

  // Workflow 6B P5-2: the preview shows once, in the evidence; the files name it.
  it('shows the evidence in the Evidence region, and names the preview in the files', async () => {
    api.me({ permissions: DOCUMENTS_REVIEWER });
    const verification = documentVerification();
    serveDocumentsVerification(api, verification, { included: documentFiles() });

    render(await page());

    const evidence = within(region('Evidence')).getByRole('group', { name: 'Document evidence' });
    expect(term(evidence, 'Class')).toHaveTextContent('Utility bill');
    expect(term(evidence, 'Name')).toHaveTextContent('QUINN VALEMONT');
    const previews = screen
      .getAllByRole('img')
      .filter((image) => image.getAttribute('src') === `/files/${DOCUMENT_IDS.preview}/rendition`);
    expect(previews).toEqual([
      within(evidence).getByRole('img', { name: 'Document preview, page 1' }),
    ]);
    const files = within(region('Files')).getByRole('list', { name: 'Document files' });
    expect(within(files).queryAllByRole('img')).toEqual([]);
    const preview = within(files)
      .getAllByRole('listitem')
      .find((item) => item.textContent.includes(DOCUMENT_IDS.preview));
    expect(preview).toHaveTextContent('Document preview');
    expect(preview).toHaveTextContent('Shown with the evidence');
  });

  // Workflow 6B P5-3: the page cannot tell its files apart without the inquiry, so it says nothing.
  it('never says no preview or upload was stored when the inquiry cannot be read', async () => {
    api.me({ permissions: ['verifications:read', 'pii:view'] });
    api.on('GET', `/verifications/${DOCUMENT_IDS.verification}`, 200, {
      data: documentVerification(),
    });

    render(await page());

    const evidence = within(region('Evidence')).getByRole('group', { name: 'Document evidence' });
    expect(evidence).not.toHaveTextContent(/No preview was stored|No upload recorded/);
    // The files are still listed, hidden, naming the permission their images need.
    expect(region('Files')).toHaveTextContent(
      'Your role cannot see these images (the inquiries:read permission).',
    );
  });

  it('lets no masked value reach the page or the RSC payload, even from the inquiry document', async () => {
    api.me({ permissions: DOCUMENTS_VIEWER });
    serveDocumentsVerification(api, documentVerification({ masked: true }), {
      seen: documentVerification(),
      included: documentFiles(),
    });

    const element = await page();
    const payload = await rscPayloadOf(element);
    render(element);

    expect(term(region('Evidence'), 'Name')).toHaveTextContent('Hidden');
    for (const value of piiValuesOf('verification/document')) {
      expect(document.body.textContent).not.toContain(value);
      expect(payload).not.toContain(value);
    }
  });
});
