import type { FileResource, VerificationResource } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { IDS, inquiryDocument } from '../testing/api-fixtures';
import { governmentIdVerification } from '../testing/lifecycle-fixtures';
import {
  SELFIE_IDS,
  selfieCapture,
  selfieInquiryDocument,
  selfieVerification,
  supersededCapture,
} from '../testing/selfie-fixtures';
import { phase5File, phase5Verification } from '../testing/phase5-fixtures';
import { VerificationCard, type VerificationCardProps } from './verification-card';

const { included } = inquiryDocument();
const verifications = included.filter(
  (resource): resource is VerificationResource => resource.type !== 'file',
);
const files = included.filter((resource): resource is FileResource => resource.type === 'file');

function card(
  id: string,
  {
    media = 'visible',
    showChecks = true,
  }: Partial<Pick<VerificationCardProps, 'media' | 'showChecks'>> = {},
) {
  const verification = verifications.find((resource) => resource.id === id);
  if (verification === undefined) throw new Error(`No verification ${id}`);
  return render(
    <VerificationCard
      verification={verification}
      files={files.filter((file) => file.relationships.verification.data.id === id)}
      media={media}
      showChecks={showChecks}
    />,
  );
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByRole('rowheader', { name }).closest('tr');
  if (row === null) throw new Error(`No row for ${name}`);
  return row;
}

/** C96.3, K7C-1: the mark of a verification the desktop's "this was not me" rejected. */
const REJECTED_NOTE = /created on a phone session the desktop rejected/;

function cardOf(verification: VerificationResource) {
  render(<VerificationCard verification={verification} files={[]} media="visible" showChecks />);
}

describe('VerificationCard of a rejected handoff (C96.3, C108, K7C-1)', () => {
  it('marks a verification from a rejected handoff in words, whatever its status', () => {
    cardOf(governmentIdVerification({ 'from-rejected-handoff': true, status: 'passed' }));

    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('From a rejected handoff');
    expect(note).toHaveTextContent(REJECTED_NOTE);
    expect(screen.getByRole('region', { name: 'Government ID' })).toContainElement(note);
    expect(screen.getByText('Status', { selector: 'dt' }).nextElementSibling).toHaveTextContent(
      'Passed',
    );
  });

  it('marks a Phase 5 type the same way, not as an attribute of its evidence', () => {
    const golden = phase5Verification('verification/database');
    cardOf({
      ...golden,
      attributes: { ...golden.attributes, 'from-rejected-handoff': true },
    });

    expect(screen.getByRole('note')).toHaveTextContent(REJECTED_NOTE);
    expect(screen.queryByText('From rejected handoff')).toBeNull();
  });

  it.each([
    ['false', false],
    ['absent, from a server before it', undefined],
  ])('says nothing of a handoff when the member is %s', (_name, value) => {
    cardOf(governmentIdVerification(value === undefined ? {} : { 'from-rejected-handoff': value }));

    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText(/handoff/i)).toBeNull();
  });
});

describe('VerificationCard', () => {
  it('is a region named after the verification type, with its status', () => {
    card(IDS.governmentId);
    const region = screen.getByRole('region', { name: 'Government ID' });

    const status = within(region).getByText('Status', { selector: 'dt' }).nextElementSibling;
    expect(status?.firstElementChild).toHaveAttribute('data-status', 'passed');
    expect(status).toHaveTextContent('Passed');
    expect(within(region).getByText(IDS.governmentId)).toBeVisible();
  });

  it('shows the issuing country and ID class of a government ID', () => {
    card(IDS.governmentId);

    expect(screen.getByText('Country').nextElementSibling).toHaveTextContent('US');
    expect(screen.getByText('ID class').nextElementSibling).toHaveTextContent('drivers_license');
  });

  it('lists every check with its status, requirement and reasons', async () => {
    card(IDS.selfie);

    // A failed check stays in view; the rest are folded away until asked for (C37).
    expect(screen.getByRole('table', { name: 'Selfie checks needing attention' })).toBeVisible();
    const comparison = rowFor('selfie_id_comparison');
    expect(within(comparison).getByText('Failed')).toHaveAttribute('data-status', 'failed');
    expect(within(comparison).getByText('Required')).toBeVisible();
    expect(within(comparison).getByText('face_mismatch')).toBeVisible();

    await userEvent.click(screen.getByText('Other checks: 1 not applicable'));
    const faces = rowFor('selfie_multiple_faces_detection');
    expect(within(faces).getByText('Not applicable')).toBeVisible();
    expect(within(faces).getByText('Advisory')).toBeVisible();
    expect(within(faces).getByText('None')).toBeVisible();
  });

  it('shows the images through the dashboard file proxy, with descriptive alt text', () => {
    card(IDS.governmentId);

    const front = screen.getByRole('img', { name: 'Government ID, front' });
    expect(front).toHaveAttribute('src', `/files/${IDS.front}/rendition`);
    expect(front).toHaveAttribute('loading', 'lazy');
    expect(screen.getByRole('img', { name: 'Government ID, back' })).toHaveAttribute(
      'src',
      `/files/${IDS.back}/rendition`,
    );
    expect(screen.getByText('Front')).toBeVisible();
  });

  it('labels selfie poses', () => {
    card(IDS.selfie);

    expect(screen.getByRole('img', { name: 'Selfie, center' })).toHaveAttribute(
      'src',
      `/files/${IDS.selfieCenter}/rendition`,
    );
  });

  it('says when no checks ran and no images were uploaded', () => {
    const [verification] = verifications;
    if (verification === undefined) throw new Error('no fixture');
    render(
      <VerificationCard
        verification={
          {
            ...verification,
            attributes: { ...verification.attributes, checks: [] },
          } as VerificationResource
        }
        files={[]}
        media="visible"
        showChecks
      />,
    );

    expect(screen.getByText('No checks have run yet.')).toBeVisible();
    expect(screen.getByText('No images uploaded.')).toBeVisible();
  });

  it('shows "Hidden" instead of the images to an operator without pii:view', () => {
    card(IDS.governmentId, { media: 'hidden' });

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const images = screen.getByRole('list', { name: 'Government ID images' });
    expect(within(images).getAllByText('Hidden')).toHaveLength(2);
    expect(within(images).getByText('Front')).toBeVisible();
    expect(within(images).getByText('Back')).toBeVisible();
  });

  it('shows "Redacted" instead of the images of a redacted inquiry', () => {
    card(IDS.selfie, { media: 'redacted' });

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const images = screen.getByRole('list', { name: 'Selfie images' });
    expect(within(images).getByText('Redacted')).toBeVisible();
    expect(within(images).getByText('Center')).toBeVisible();
  });

  it('shows a government ID in review with the checks that sent it there, Beta badges and confidences (C30.4, C37)', async () => {
    render(
      <VerificationCard
        verification={governmentIdVerification({
          status: 'needs_review',
          checks: [
            {
              name: 'id_tamper_detection',
              status: 'passed',
              reasons: [],
              requirement: 'not_required',
              metadata: {},
              stage: 'beta',
              confidence: 0.58,
              provenance: { 'implementation-version': 1, thresholds: { 'max-tamper-score': 0.5 } },
            },
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
        })}
        files={[]}
        media="visible"
        showChecks
      />,
    );

    const region = screen.getByRole('region', { name: 'Government ID' });
    expect(within(region).getByText('Needs review', { selector: '[data-status]' })).toBeVisible();
    expect(within(region).getByRole('note', { name: 'Why it needs review' })).toHaveTextContent(
      'id_public_figure_detection (Not configured)',
    );
    const review = rowFor('id_public_figure_detection');
    expect(within(review).getByText('Beta')).toBeVisible();
    expect(within(review).getByText('Not configured')).toBeVisible();
    await userEvent.click(within(region).getByText('Other checks: 1 passed'));
    const tamper = rowFor('id_tamper_detection');
    expect(within(tamper).getByText('Beta')).toBeVisible();
    expect(within(tamper).getByText('Confidence')).toBeVisible();
    expect(within(tamper).getByText('0.58')).toBeVisible();
  });

  it('leaves out the check details without verifications:read', () => {
    card(IDS.selfie, { showChecks: false });

    expect(screen.queryByRole('table', { hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText(/verifications:read/)).toBeVisible();
    expect(screen.queryByText('face_mismatch')).not.toBeInTheDocument();
  });
});

describe('VerificationCard of a selfie taken through a capture (C40, C43, C47)', () => {
  const document = selfieInquiryDocument();
  const allFiles = document.included.filter(
    (resource): resource is FileResource => resource.type === 'file',
  );
  const selfieFiles = allFiles.filter(
    (file) => file.relationships.verification.data.id === SELFIE_IDS.selfie,
  );

  function selfieCard(showChecks = true) {
    return render(
      <VerificationCard
        verification={selfieVerification()}
        files={selfieFiles}
        media="visible"
        showChecks={showChecks}
        captures={[supersededCapture(), selfieCapture()]}
        referenceFiles={allFiles}
      />,
    );
  }

  it('names the capture method and the liveness mode', () => {
    selfieCard();

    const region = screen.getByRole('region', { name: 'Selfie' });
    expect(within(region).getByText('Capture method').nextElementSibling).toHaveTextContent(
      'Camera',
    );
    expect(
      within(region).getByText('Liveness', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('Active (head turns)');
  });

  it('shows the pose photos in prompt order, the ID comparison beside the centre with the ID photo in a closed disclosure', () => {
    selfieCard();

    const list = screen.getByRole('list', { name: 'Selfie images' });
    expect(
      within(list)
        .getAllByRole('img', { name: /^Selfie, / })
        .map((image) => image.getAttribute('alt')),
    ).toEqual(['Selfie, center', 'Selfie, right', 'Selfie, left']);
    const comparison = within(list).getByRole('group', { name: 'Compared with the government ID' });
    expect(within(comparison).getByText('0.6512')).toBeVisible();
    expect(within(comparison).getByText('Calibrated')).toBeVisible();
    const idPhoto = within(comparison).getByRole('img', {
      name: 'Government ID front, whose portrait was compared',
    });
    expect(idPhoto).toHaveAttribute('src', `/files/${SELFIE_IDS.front}/rendition`);
    expect(idPhoto.closest('details')).not.toHaveAttribute('open');
  });

  it('shows the scores, what liveness recorded and the consumed capture’s prompt timings', () => {
    selfieCard();

    expect(screen.getByRole('heading', { level: 4, name: 'Scores' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Selfie scores' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Liveness' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Selfie liveness' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 4, name: 'Prompt timings' })).toBeVisible();
    expect(
      within(screen.getByRole('table', { name: 'Selfie prompt timings' }))
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual(['Center', 'Right', 'Left']);
  });

  it('leaves the comparison, scores and liveness out without verifications:read, and keeps the photos in prompt order', () => {
    selfieCard(false);

    expect(screen.queryByRole('group', { name: 'Compared with the government ID' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Selfie scores' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Selfie liveness' })).toBeNull();
    expect(screen.getAllByRole('img').map((image) => image.getAttribute('alt'))).toEqual([
      'Selfie, center',
      'Selfie, right',
      'Selfie, left',
    ]);
  });
});

describe('VerificationCard of a Phase 5 verification (C54.5)', () => {
  const PDF = 'file_01JB0000000000000000000020';
  const PREVIEW = 'file_01JB0000000000000000000021';
  const document = phase5Verification('verification/document', { fileIds: [PDF, PREVIEW] });
  const documentFiles = [
    phase5File(PDF, 'document', 'application/pdf', document),
    phase5File(PREVIEW, 'document-preview', 'image/png', document),
  ];

  it('shows its evidence after the checks', () => {
    render(
      <VerificationCard
        verification={phase5Verification('verification/database')}
        files={[]}
        media="visible"
        showChecks
      />,
    );

    const region = screen.getByRole('region', { name: 'Database' });
    const headings = within(region)
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['Checks', 'Evidence', 'Files']);
    const evidence = within(region).getByRole('group', { name: 'Database evidence' });
    expect(within(evidence).getByText('Name first').nextElementSibling).toHaveTextContent('Avery');
    expect(within(region).getByText('No files uploaded.')).toBeVisible();
  });

  // Workflow 5C review P024: the evidence's part titles are headings one below the card's h4.
  it('titles a document’s evidence parts with level 5 headings, under its Evidence heading', () => {
    render(
      <VerificationCard
        verification={phase5Verification('verification/document')}
        files={[]}
        media="visible"
        showChecks
      />,
    );

    const evidence = screen.getByRole('group', { name: 'Document evidence' });
    expect(within(evidence).getAllByRole('heading', { level: 5 }).length).toBeGreaterThan(0);
    expect(within(evidence).queryAllByRole('heading', { level: 3 })).toEqual([]);
  });

  it('shows "Hidden" for the personal values the API masked, and "Redacted" after a redaction', () => {
    const masked = phase5Verification('verification/email-address', { masked: true });
    const { unmount } = render(
      <VerificationCard verification={masked} files={[]} media="hidden" showChecks />,
    );
    expect(
      screen.getByText('Email address', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('Hidden');
    unmount();

    render(<VerificationCard verification={masked} files={[]} media="redacted" showChecks />);
    expect(
      screen.getByText('Email address', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('Redacted');
  });

  it('lists a file that is not an image by its kind and ID', () => {
    render(
      <VerificationCard verification={document} files={documentFiles} media="visible" showChecks />,
    );

    const files = screen.getByRole('list', { name: 'Document files' });
    const [pdf] = within(files).getAllByRole('listitem');
    expect(pdf).toHaveTextContent('Document');
    expect(pdf).toHaveTextContent(PDF);
    expect(pdf).toHaveTextContent('application/pdf');
  });

  // Workflow 6B P5-2 (a Phase 5 console gap): the preview showed in the evidence and again here.
  it('shows a document’s preview once, in its evidence, and names it in its files', () => {
    render(
      <VerificationCard verification={document} files={documentFiles} media="visible" showChecks />,
    );

    const previews = screen
      .getAllByRole('img')
      .filter((image) => image.getAttribute('src') === `/files/${PREVIEW}/rendition`);
    expect(previews.map((image) => image.getAttribute('alt'))).toEqual([
      'Document preview, page 1',
    ]);
    const files = screen.getByRole('list', { name: 'Document files' });
    expect(within(files).queryAllByRole('img')).toEqual([]);
    const preview = within(files)
      .getAllByRole('listitem')
      .find((item) => item.textContent.includes(PREVIEW));
    expect(preview).toHaveTextContent('Document preview');
    expect(preview).toHaveTextContent('image/png');
    expect(preview).toHaveTextContent('Shown with the evidence');
  });

  it('still shows a photo original with the files, as its evidence says', () => {
    const PHOTO = 'file_01JB0000000000000000000022';
    const photo = phase5Verification('verification/document', { fileIds: [PHOTO, PREVIEW] });
    render(
      <VerificationCard
        verification={photo}
        files={[
          phase5File(PHOTO, 'document', 'image/jpeg', photo),
          phase5File(PREVIEW, 'document-preview', 'image/png', photo),
        ]}
        media="visible"
        showChecks
      />,
    );

    const files = screen.getByRole('list', { name: 'Document files' });
    expect(
      within(files)
        .getAllByRole('img')
        .map((image) => image.getAttribute('alt')),
    ).toEqual(['Document, document']);
    expect(screen.getByRole('group', { name: 'Document evidence' })).toHaveTextContent(
      'The original photo is shown with the files.',
    );
  });
});
