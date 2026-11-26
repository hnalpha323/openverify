import type {
  DashboardInquiryDocument,
  FileResource,
  SelfieCaptureResource,
  VerificationResource,
} from '@openverify/contracts';
import { Alert } from '@openverify/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { evidencePreviewOf } from '../lib/document-evidence';
import { FILE_KIND_LABELS, VERIFICATION_TYPE_LABELS } from '../lib/labels';
import {
  capturesOf,
  consumedCapture,
  idComparisonOf,
  livenessEvidenceOf,
  posePhotos,
  promptOrder,
  referenceFront,
  type SelfieVerification,
} from '../lib/selfie-evidence';
import { CASES_REPORTS_COPY } from '../lib/copy/cases-reports';
import { CheckResults } from './check-results';
import { DataTable } from './data-table';
import { Detail } from './detail';
import { VerificationEvidence, isPhase5Verification } from './evidence';
import { ExtractionTable } from './extraction-table';
import { ForbiddenPanel } from './forbidden-panel';
import type { SectionData } from './lifecycle/section-data';
import { PageSection } from './lifecycle/page-section';
import { LINK_CLASS } from './link-styles';
import { PageHeader, type Breadcrumb } from './page-header';
import { PageMain } from './page-main';
import { RejectedHandoffNote } from './rejected-handoff-note';
import {
  LivenessSummary,
  PromptTimings,
  SelfieCaptureDetails,
  SelfieCaptures,
  SelfiePhotos,
  SelfieScores,
} from './selfie-evidence';
import { VerificationStatusBadge } from './status-badge';
import { Timestamp, formatUtc } from './timestamp';
import { FileShownInEvidence, NonImageFile, isImageFile } from './verification-file';
import { VerificationImage, type VerificationMedia } from './verification-image';

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;

export interface VerificationViewProps {
  readonly verification: VerificationResource;
  /** A selfie's captures (`?include=selfies`, C40.1), newest first; none for a government ID. */
  readonly captures?: readonly SelfieCaptureResource[];
  /**
   * The inquiry it belongs to, with `inquiries:read` (`GET /dashboard/inquiries/:id`): its file
   * resources name each file's kind, and its `redacted-at` says the files are gone.
   */
  readonly inquiry: SectionData<DashboardInquiryDocument>;
  /** `pii:view`: the images need it, and `inquiries:read` (C15). */
  readonly piiView: boolean;
  /**
   * C173.2 (K17): the verification's own file resources (`?include=files`), metadata only, so a
   * reader without `inquiries:read` still sees what each file is.
   */
  readonly ownFileResources?: readonly FileResource[];
  /** C173.3: the page's Print button and its printed footer. */
  readonly print?: { readonly button: ReactNode; readonly footer: ReactNode } | undefined;
}

/**
 * Why the images are hidden when the inquiry could not be read (Workflow 2E E001): the file
 * content needs `inquiries:read`, and `pii:view` as well when the role lacks it too.
 */
function inquiryHiddenExplanation(piiView: boolean): string {
  return piiView
    ? 'Your role cannot see these images (the inquiries:read permission).'
    : 'Your role cannot see these images (the inquiries:read and pii:view permissions).';
}

/**
 * A selfie's files (C47): the pose photos in prompt order, each captioned with its file id, and
 * the government ID photo beside the centre one with the similarity, threshold and basis. Without
 * the inquiry (no `inquiries:read`) the file kinds are unknown: each prompted pose reads "Hidden",
 * and the file ids are listed apart.
 */
function SelfieFiles({
  verification,
  label,
  captures,
  inquiryFiles,
  media,
  hiddenExplanation,
  forbidden,
}: {
  readonly verification: SelfieVerification;
  readonly label: string;
  readonly captures: readonly SelfieCaptureResource[];
  /** The inquiry's file resources, or `null` when the inquiry could not be read. */
  readonly inquiryFiles: readonly FileResource[] | null;
  readonly media: VerificationMedia;
  readonly hiddenExplanation: string | undefined;
  readonly forbidden: boolean;
}) {
  const fileIds = verification.relationships.files.data.map(({ id }) => id);
  const own = (inquiryFiles ?? []).filter((file) => fileIds.includes(file.id));
  const consumed = consumedCapture(capturesOf(captures, verification.id));
  const order = promptOrder(verification, consumed, own);
  const photos =
    inquiryFiles === null
      ? order.map((pose) => ({ pose, file: undefined, prompted: true }))
      : posePhotos(order, own);
  if (photos.length === 0 && fileIds.length === 0) {
    return <p className="text-sm text-ink-muted">No files uploaded.</p>;
  }
  const comparison = idComparisonOf(verification);
  return (
    <>
      {/* The API refused the inquiry the images are read through: say which permission. */}
      {forbidden && <ForbiddenPanel headingLevel={3} permissions={['inquiries:read']} />}
      {photos.length > 0 && (
        <SelfiePhotos
          label={label}
          photos={photos}
          media={media}
          hiddenExplanation={hiddenExplanation}
          comparison={verification.attributes.checks.length > 0 ? comparison : undefined}
          idFront={referenceFront(inquiryFiles ?? [], comparison.referenceId)}
          idImage="shown"
          showFileIds
          filesKnown={inquiryFiles !== null}
        />
      )}
      {inquiryFiles === null && fileIds.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">File IDs</p>
          <ul aria-label={`${label} file IDs`} className="flex flex-col gap-0.5">
            {fileIds.map((id) => (
              <li key={id}>{code(id)}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

const noChecks = <p className="text-sm text-ink-muted">No checks have run yet.</p>;

/**
 * A selfie's evidence below its files (C47): the C40.10 scores with their thresholds and basis,
 * what liveness recorded, the consumed capture's prompt timings, and every capture of the
 * verification, newest first.
 */
function SelfieEvidenceSections({
  verification,
  label,
  captures,
}: {
  readonly verification: SelfieVerification;
  readonly label: string;
  readonly captures: readonly SelfieCaptureResource[];
}) {
  const own = capturesOf(captures, verification.id);
  const ran = verification.attributes.checks.length > 0;
  const evidence = livenessEvidenceOf(verification);
  return (
    <>
      <PageSection
        id="verification-scores"
        title="Scores"
        description="Each score with the threshold it was judged against and how that threshold was set."
      >
        {ran ? <SelfieScores label={label} evidence={evidence} /> : noChecks}
      </PageSection>
      <PageSection id="verification-liveness" title="Liveness">
        {ran ? <LivenessSummary label={label} evidence={evidence} /> : noChecks}
      </PageSection>
      <PageSection id="verification-prompt-timings" title="Prompt timings">
        <PromptTimings label={label} capture={consumedCapture(own)} />
      </PageSection>
      <PageSection id="verification-captures" title="Captures">
        {own.length === 0 ? (
          <p className="text-sm text-ink-muted">No selfie captures.</p>
        ) : (
          <SelfieCaptures caption={`${label} captures`} captures={own} />
        )}
      </PageSection>
    </>
  );
}

/** C173.2: the verification's files by their metadata only; a file's bytes open on their own page. */
function FileMetadata({ files }: { readonly files: readonly FileResource[] }) {
  return (
    <DataTable
      caption="File metadata"
      rows={files}
      getRowKey={(file) => file.id}
      emptyMessage={CASES_REPORTS_COPY.verificationFiles.empty}
      columns={[
        { id: 'id', header: 'File', rowHeader: true, cell: (file) => code(file.id) },
        { id: 'kind', header: 'Kind', cell: (file) => FILE_KIND_LABELS[file.attributes.kind] },
        { id: 'type', header: 'Media type', cell: (file) => file.attributes['mime-type'] },
        {
          id: 'size',
          header: 'Size',
          cell: (file) => `${String(Math.ceil(file.attributes['byte-size'] / 1024))} KiB`,
        },
        {
          id: 'created',
          header: 'Uploaded (UTC)',
          cell: (file) => <Timestamp value={file.attributes['created-at']} />,
        },
      ]}
    />
  );
}

/**
 * One verification (C26): its status and details, a government ID's extraction (C31.5: "Hidden"
 * without `pii:view`, "Redacted" after a redaction), every check with its reasons, metadata and
 * provenance (C37), and the files it was run on; a selfie also its capture method and liveness,
 * its photos in prompt order beside the ID comparison, its scores, liveness, prompt timings and
 * captures (C47). Images show through the file proxy to an operator with `pii:view` and
 * `inquiries:read`, as "Hidden" otherwise (naming the permission missing), and as "Redacted" once
 * the inquiry is redacted. Without the inquiry, nothing links to it (Workflow 2E E001). A Phase 5
 * type shows its evidence through its type's component (C54.5), and names a file that is not an
 * image (a PDF document, a chip file) by its kind, media type and ID.
 */
export function VerificationView({
  verification,
  captures = [],
  inquiry,
  piiView,
  ownFileResources = [],
  print,
}: VerificationViewProps) {
  const label = VERIFICATION_TYPE_LABELS[verification.type];
  const { attributes } = verification;
  const inquiryId = verification.relationships.inquiry.data.id;
  const document = inquiry.kind === 'ready' ? inquiry.data : null;
  // C173.2: the verification says itself when its inquiry was redacted, whoever reads it.
  const redactedAt = attributes['redacted-at'] ?? document?.data.attributes['redacted-at'] ?? null;
  const media: VerificationMedia =
    redactedAt !== null ? 'redacted' : piiView && document !== null ? 'visible' : 'hidden';
  const hiddenExplanation = document === null ? inquiryHiddenExplanation(piiView) : undefined;
  const inquiryHref = `/inquiries/${inquiryId}`;
  /** A breadcrumb above the verification: a link only when the inquiry could be read. */
  const parentCrumb = (crumbLabel: ReactNode, href: string): Breadcrumb =>
    document === null ? { label: crumbLabel } : { label: crumbLabel, href };
  const fileResources = new Map(
    [
      ...ownFileResources,
      ...(document?.included ?? []).filter(
        (resource): resource is FileResource => resource.type === 'file',
      ),
    ].map((file) => [file.id, file]),
  );
  /** The inquiry's file resources, or `null` when the inquiry could not be read. */
  const inquiryFiles = document === null ? null : [...fileResources.values()];
  const files = verification.relationships.files.data.map(({ id }) => ({
    id,
    kind: fileResources.get(id)?.attributes.kind,
    mimeType: fileResources.get(id)?.attributes['mime-type'],
  }));
  /** The verification's own file resources, as far as the inquiry document names them. */
  const ownFiles = verification.relationships.files.data.flatMap(({ id }) => {
    const file = fileResources.get(id);
    return file === undefined ? [] : [file];
  });
  /** Workflow 6B P5-2: the file the evidence shows, which the files name instead. */
  const shownInEvidence = evidencePreviewOf(verification, ownFiles)?.id;
  /** C31.6, C53.7: the API masked personal data per operator; a redaction removed it. */
  const piiState = redactedAt !== null ? 'redacted' : piiView ? 'visible' : 'hidden';

  return (
    <PageMain className="gap-8">
      <PageHeader
        breadcrumbs={[
          parentCrumb('Inquiries', '/inquiries'),
          parentCrumb(<>Inquiry {code(inquiryId)}</>, inquiryHref),
          { label: code(verification.id) },
        ]}
        title={
          <>
            {label} verification {code(verification.id)}
          </>
        }
        description={<VerificationStatusBadge status={attributes.status} />}
        actions={print?.button}
      />

      {redactedAt !== null && (
        <Alert tone="info" title="Redacted" aria-label="Redacted">
          The inquiry of this verification was redacted on {formatUtc(redactedAt)} UTC. Its check
          details and files were deleted for good.
        </Alert>
      )}
      <RejectedHandoffNote verification={verification} />
      <PageSection id="verification-details" title="Details">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Detail term="Status">
            <VerificationStatusBadge status={attributes.status} />
          </Detail>
          <Detail term="Type">{label}</Detail>
          <Detail term="Inquiry">
            {document === null ? (
              code(inquiryId)
            ) : (
              <Link href={inquiryHref} className={LINK_CLASS}>
                {code(inquiryId)}
              </Link>
            )}
          </Detail>
          {verification.type === 'verification/government-id' && (
            <>
              <Detail term="Country">{verification.attributes.country ?? 'Unknown'}</Detail>
              <Detail term="ID class">
                {code(verification.attributes['id-class'] ?? 'unknown')}
              </Detail>
            </>
          )}
          {verification.type === 'verification/selfie' && (
            <SelfieCaptureDetails verification={verification} />
          )}
          <Detail term="Created (UTC)">
            <Timestamp value={attributes['created-at']} />
          </Detail>
          <Detail term="Updated (UTC)">
            <Timestamp value={attributes['updated-at']} />
          </Detail>
        </dl>
      </PageSection>

      {verification.type === 'verification/government-id' && (
        <PageSection
          id="verification-extraction"
          title="Extraction"
          description="The fields read from the document, and the sources that agree on each."
        >
          <ExtractionTable verification={verification} state={piiState} />
        </PageSection>
      )}

      {isPhase5Verification(verification) && (
        <PageSection
          id="verification-evidence"
          title="Evidence"
          description="What the verification recorded, as the API shows it to your role."
        >
          <VerificationEvidence
            verification={verification}
            label={label}
            state={piiState}
            // C66: the inquiry document names each file's kind; without it, none is known, so a
            // type never says a file was not stored (Workflow 6B P5-3).
            files={ownFiles.length === files.length ? ownFiles : null}
            media={media}
            // C66: unknown without the inquiry document, so the chip evidence points instead.
            inquiryFiles={inquiryFiles ?? undefined}
            // P024: its part titles are headings one below the page's h2.
            partHeadingLevel={3}
          />
        </PageSection>
      )}

      <PageSection id="verification-checks" title="Checks">
        {attributes.checks.length === 0 ? (
          <p className="text-sm text-ink-muted">No checks have run yet.</p>
        ) : (
          <CheckResults
            checks={attributes.checks}
            label={label}
            status={attributes.status}
            detailed
          />
        )}
      </PageSection>

      <PageSection id="verification-files" title="Files">
        {ownFileResources.length > 0 && <FileMetadata files={ownFileResources} />}
        {verification.type === 'verification/selfie' ? (
          <SelfieFiles
            verification={verification}
            label={label}
            captures={captures}
            inquiryFiles={inquiryFiles}
            media={media}
            hiddenExplanation={hiddenExplanation}
            forbidden={inquiry.kind === 'forbidden'}
          />
        ) : files.length === 0 ? (
          <p className="text-sm text-ink-muted">No files uploaded.</p>
        ) : (
          <>
            {/* The API refused the inquiry the images are read through: say which permission. */}
            {inquiry.kind === 'forbidden' && (
              <ForbiddenPanel headingLevel={3} permissions={['inquiries:read']} />
            )}
            <ul aria-label={`${label} files`} className="flex flex-wrap gap-4">
              {files.map((file) => {
                const kind = file.kind === undefined ? undefined : FILE_KIND_LABELS[file.kind];
                if (
                  file.id === shownInEvidence &&
                  kind !== undefined &&
                  file.mimeType !== undefined
                ) {
                  return (
                    <li key={file.id}>
                      <FileShownInEvidence kind={kind} mimeType={file.mimeType} fileId={file.id} />
                    </li>
                  );
                }
                // C54.5: a PDF document or a chip file is named, not shown as an image.
                if (
                  kind !== undefined &&
                  file.mimeType !== undefined &&
                  !isImageFile(file.mimeType)
                ) {
                  return (
                    <li key={file.id}>
                      <NonImageFile kind={kind} mimeType={file.mimeType} caption={code(file.id)} />
                    </li>
                  );
                }
                return (
                  <li key={file.id}>
                    <VerificationImage
                      fileId={file.id}
                      alt={kind === undefined ? `${label} file` : `${label}, ${kind.toLowerCase()}`}
                      media={media}
                      hiddenExplanation={hiddenExplanation}
                      caption={
                        <>
                          {kind !== undefined && <span>{kind}</span>}
                          {code(file.id)}
                        </>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </PageSection>

      {verification.type === 'verification/selfie' && (
        <SelfieEvidenceSections verification={verification} label={label} captures={captures} />
      )}
      {print?.footer}
    </PageMain>
  );
}
