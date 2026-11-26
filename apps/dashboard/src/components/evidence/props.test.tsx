/**
 * C54.5, C66: the verification card and the verification page hand a Phase 5 evidence component
 * the verification's own files and how its images may show, beside its answer and the PII state,
 * so a type can show its document preview or its chip portrait through the file proxy. The
 * document component is replaced here with one that says what it was given.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIFECYCLE_IDS as IDS, T1, inquiryDocument } from '../../testing/lifecycle-fixtures';
import { phase5File, phase5Verification } from '../../testing/phase5-fixtures';
import { VerificationCard } from '../verification-card';
import { VerificationView } from '../verification-view';
import type { EvidenceProps } from './generic';

const ids = (files: EvidenceProps['files']) =>
  files === undefined
    ? 'not given'
    : files === null
      ? 'unknown'
      : files.length === 0
        ? 'none'
        : files.map((file) => file.id).join(' ');

vi.mock('./document', () => ({
  DocumentEvidence: ({ files, media, state, inquiryFiles }: EvidenceProps) => (
    <>
      <p>{`Files: ${ids(files)}; media: ${media ?? 'not given'}; state: ${state}`}</p>
      <p>{`Inquiry files: ${ids(inquiryFiles)}`}</p>
    </>
  ),
}));

const PDF = 'file_01JB0000000000000000000020';
const PREVIEW = 'file_01JB0000000000000000000021';
const document = phase5Verification('verification/document', {
  id: IDS.governmentId,
  fileIds: [PDF, PREVIEW],
});
const files = [
  phase5File(PDF, 'document', 'application/pdf', document),
  phase5File(PREVIEW, 'document-preview', 'image/png', document),
];
/** A file of another verification of the inquiry: an earlier document attempt's PDF. */
const OTHER = 'file_01JB0000000000000000000022';
const OTHER_FILE = phase5File(OTHER, 'document', 'application/pdf', {
  type: 'verification/document',
  id: 'ver_01JB0000000000000000000099',
});

/** The inquiry document carrying the verification, its files and another verification's file. */
function inquiryWith(attributes: Parameters<typeof inquiryDocument>[0] = {}) {
  const inquiry = inquiryDocument(attributes);
  return {
    ...inquiry,
    included: [
      ...inquiry.included.filter((resource) => resource.id !== IDS.governmentId),
      document,
      ...files,
    ],
  };
}

describe('the props of a Phase 5 evidence component (C54.5, C66)', () => {
  it('gets the verification files and their media from the card', () => {
    render(<VerificationCard verification={document} files={files} media="visible" showChecks />);

    expect(
      screen.getByText(`Files: ${PDF} ${PREVIEW}; media: visible; state: visible`),
    ).toBeInTheDocument();
  });

  it('gets the verification files from the page, and no file of another verification', () => {
    render(
      <VerificationView
        verification={document}
        inquiry={{ kind: 'ready', data: inquiryWith() }}
        piiView
      />,
    );

    expect(
      screen.getByText(`Files: ${PDF} ${PREVIEW}; media: visible; state: visible`),
    ).toBeInTheDocument();
  });

  it('gets the media and the state as hidden on the page without pii:view, and redacted after a redaction', () => {
    const { unmount } = render(
      <VerificationView
        verification={document}
        inquiry={{ kind: 'ready', data: inquiryWith() }}
        piiView={false}
      />,
    );
    expect(
      screen.getByText(`Files: ${PDF} ${PREVIEW}; media: hidden; state: hidden`),
    ).toBeInTheDocument();
    unmount();

    render(
      <VerificationView
        verification={document}
        inquiry={{ kind: 'ready', data: inquiryWith({ 'redacted-at': T1 }) }}
        piiView
      />,
    );
    expect(
      screen.getByText(`Files: ${PDF} ${PREVIEW}; media: redacted; state: redacted`),
    ).toBeInTheDocument();
  });

  // Workflow 6B P5-3: unknown, not none, so no type says a file was not stored.
  it('gets the files as unknown on the page when the inquiry, which names their kinds, could not be read', () => {
    render(<VerificationView verification={document} inquiry={{ kind: 'hidden' }} piiView />);

    expect(screen.getByText('Files: unknown; media: hidden; state: visible')).toBeInTheDocument();
  });

  it('gets the inquiry’s files from the card when it holds them, and none given otherwise (C66)', () => {
    const { unmount } = render(
      <VerificationCard
        verification={document}
        files={files}
        media="visible"
        showChecks
        referenceFiles={[...files, OTHER_FILE]}
      />,
    );
    expect(screen.getByText(`Inquiry files: ${PDF} ${PREVIEW} ${OTHER}`)).toBeInTheDocument();
    unmount();

    render(<VerificationCard verification={document} files={files} media="visible" showChecks />);
    expect(screen.getByText('Inquiry files: not given')).toBeInTheDocument();
  });

  it('gets the inquiry’s files from the page when the inquiry document is known, and none given otherwise (C66)', () => {
    const inquiry = inquiryWith();
    const { unmount } = render(
      <VerificationView
        verification={document}
        inquiry={{
          kind: 'ready',
          data: { ...inquiry, included: [...inquiry.included, OTHER_FILE] },
        }}
        piiView
      />,
    );
    // Every file the inquiry document lists, in its order: the other verifications' too.
    expect(
      screen.getByText(
        `Inquiry files: ${IDS.front} ${IDS.back} ${IDS.selfieCenter} ${PDF} ${PREVIEW} ${OTHER}`,
      ),
    ).toBeInTheDocument();
    unmount();

    render(<VerificationView verification={document} inquiry={{ kind: 'forbidden' }} piiView />);
    expect(screen.getByText('Inquiry files: not given')).toBeInTheDocument();
  });
});
