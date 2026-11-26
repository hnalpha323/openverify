import type {
  FileResource,
  SelfieCaptureResource,
  VerificationResource,
} from '@openverify/contracts';
import { Card } from '@openverify/ui';
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
import { CheckResults } from './check-results';
import { Detail } from './detail';
import { VerificationEvidence, isPhase5Verification } from './evidence';
import { LINK_CLASS } from './link-styles';
import { RejectedHandoffNote } from './rejected-handoff-note';
import {
  LivenessSummary,
  PromptTimings,
  SelfieCaptureDetails,
  SelfiePhotos,
  SelfieScores,
} from './selfie-evidence';
import { VerificationStatusBadge } from './status-badge';
import { Timestamp } from './timestamp';
import { FileShownInEvidence, NonImageFile, isImageFile } from './verification-file';
import { VerificationImage, type VerificationMedia } from './verification-image';

export interface VerificationCardProps {
  readonly verification: VerificationResource;
  /**
   * The card's heading and region name; the verification type by default. Retries of one type
   * need distinct ones, such as "Government ID, attempt 2" ({@link verificationTitles}).
   */
  readonly title?: string | undefined;
  /** The verification's files, in upload order. */
  readonly files: readonly FileResource[];
  readonly media: VerificationMedia;
  /** The operator holds `verifications:read`, which the check details need (C23). */
  readonly showChecks: boolean;
  /** The verification ID links the verification's own page (C26). */
  readonly linked?: boolean;
  /** A selfie's captures (C40.1); those of other verifications are ignored. */
  readonly captures?: readonly SelfieCaptureResource[] | undefined;
  /**
   * The inquiry's files: a selfie shows the front of the government ID it was compared with, and
   * a chip read the selfie centre photo its portrait was compared with (C66).
   */
  readonly referenceFiles?: readonly FileResource[] | undefined;
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-base font-semibold">{title}</h4>
      {children}
    </div>
  );
}

/**
 * A selfie's evidence on its card (C47): the photos in prompt order with the ID comparison
 * beside the centre one (the ID photo behind a disclosure, since the government ID card on the
 * same page shows it), then, with the check details, the scores, what liveness recorded and the
 * consumed capture's prompt timings.
 */
function SelfieSections({
  verification,
  label,
  files,
  media,
  showChecks,
  captures,
  referenceFiles,
}: {
  readonly verification: SelfieVerification;
  readonly label: string;
  readonly files: readonly FileResource[];
  readonly media: VerificationMedia;
  readonly showChecks: boolean;
  readonly captures: readonly SelfieCaptureResource[];
  readonly referenceFiles: readonly FileResource[];
}) {
  const consumed = consumedCapture(capturesOf(captures, verification.id));
  const photos = posePhotos(promptOrder(verification, consumed, files), files);
  const comparison = idComparisonOf(verification);
  const evidence = livenessEvidenceOf(verification);
  const ran = showChecks && verification.attributes.checks.length > 0;
  return (
    <>
      <Section title="Images">
        {photos.length === 0 ? (
          <p className="text-sm text-ink-muted">No images uploaded.</p>
        ) : (
          <SelfiePhotos
            label={label}
            photos={photos}
            media={media}
            comparison={ran ? comparison : undefined}
            idFront={referenceFront(referenceFiles, comparison.referenceId)}
            idImage="disclosed"
          />
        )}
      </Section>
      {ran && (
        <>
          <Section title="Scores">
            <SelfieScores label={label} evidence={evidence} />
          </Section>
          <Section title="Liveness">
            <LivenessSummary label={label} evidence={evidence} />
          </Section>
          <Section title="Prompt timings">
            <PromptTimings label={label} capture={consumed} />
          </Section>
        </>
      )}
    </>
  );
}

/**
 * The files of a verification other than a selfie: each image through the file proxy (or
 * "Hidden", "Redacted"), and a file that is not an image (C52.4: a PDF document, a chip file) by
 * its kind, media type and ID (C54.5). The file the evidence shows (a document's preview) is
 * named the same way, not shown twice (Workflow 6B P5-2).
 */
function FileSection({
  label,
  files,
  media,
  noun,
  shownInEvidence,
}: {
  readonly label: string;
  readonly files: readonly FileResource[];
  readonly media: VerificationMedia;
  readonly noun: 'images' | 'files';
  /** The id of the file the evidence shows. */
  readonly shownInEvidence: string | undefined;
}) {
  return (
    <Section title={noun === 'images' ? 'Images' : 'Files'}>
      {files.length === 0 ? (
        <p className="text-sm text-ink-muted">No {noun} uploaded.</p>
      ) : (
        <ul aria-label={`${label} ${noun}`} className="flex flex-wrap gap-4">
          {files.map((file) => {
            const kind = FILE_KIND_LABELS[file.attributes.kind];
            const mimeType = file.attributes['mime-type'];
            return (
              <li key={file.id}>
                {file.id === shownInEvidence ? (
                  <FileShownInEvidence kind={kind} mimeType={mimeType} fileId={file.id} />
                ) : isImageFile(mimeType) ? (
                  <VerificationImage
                    fileId={file.id}
                    alt={`${label}, ${kind.toLowerCase()}`}
                    media={media}
                    caption={kind}
                  />
                ) : (
                  <NonImageFile
                    kind={kind}
                    mimeType={mimeType}
                    caption={<code className="font-mono break-all">{file.id}</code>}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/**
 * The heading of each verification: its type, or "<type>, attempt <n>" when the inquiry has more
 * than one of that type (a retry), numbered by creation time (Workflow 2E F015).
 */
export function verificationTitles(
  verifications: readonly VerificationResource[],
): ReadonlyMap<string, string> {
  const byType = new Map<string, VerificationResource[]>();
  for (const verification of verifications) {
    byType.set(verification.type, [...(byType.get(verification.type) ?? []), verification]);
  }
  const titles = new Map<string, string>();
  for (const [type, ofType] of byType) {
    const label = VERIFICATION_TYPE_LABELS[type as VerificationResource['type']];
    const ordered = [...ofType].sort(
      (a, b) =>
        a.attributes['created-at'].localeCompare(b.attributes['created-at']) ||
        a.id.localeCompare(b.id),
    );
    ordered.forEach((verification, index) => {
      titles.set(
        verification.id,
        ordered.length === 1 ? label : `${label}, attempt ${String(index + 1)}`,
      );
    });
  }
  return titles;
}

/**
 * One verification: its status, its checks and the images it was run on; a selfie also shows its
 * evidence (C47): the photos in prompt order, the ID comparison, the scores, liveness and timings;
 * a Phase 5 type its evidence through its type's component (C54.5) and its files.
 */
export function VerificationCard({
  verification,
  title,
  files,
  media,
  showChecks,
  linked = false,
  captures = [],
  referenceFiles,
}: VerificationCardProps) {
  const label = title ?? VERIFICATION_TYPE_LABELS[verification.type];
  const { checks } = verification.attributes;

  return (
    <Card title={label} headingLevel={3} className="flex flex-col gap-5">
      <RejectedHandoffNote verification={verification} />
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail term="Status">
          <VerificationStatusBadge status={verification.attributes.status} />
        </Detail>
        <Detail term="Verification ID">
          {linked ? (
            <Link href={`/verifications/${verification.id}`} className={LINK_CLASS}>
              <code className="font-mono text-xs break-all">{verification.id}</code>
            </Link>
          ) : (
            <code className="font-mono text-xs break-all">{verification.id}</code>
          )}
        </Detail>
        <Detail term="Created (UTC)">
          <Timestamp value={verification.attributes['created-at']} />
        </Detail>
        {verification.type === 'verification/government-id' && (
          <>
            <Detail term="Country">{verification.attributes.country ?? 'Unknown'}</Detail>
            <Detail term="ID class">
              <code className="font-mono text-xs">
                {verification.attributes['id-class'] ?? 'unknown'}
              </code>
            </Detail>
          </>
        )}
        {verification.type === 'verification/selfie' && (
          <SelfieCaptureDetails verification={verification} />
        )}
      </dl>

      <div className="flex flex-col gap-2">
        <h4 className="text-base font-semibold">Checks</h4>
        {!showChecks ? (
          <p className="text-sm text-ink-muted">
            Check details need the <code className="font-mono text-xs">verifications:read</code>{' '}
            permission.
          </p>
        ) : checks.length === 0 ? (
          <p className="text-sm text-ink-muted">No checks have run yet.</p>
        ) : (
          <CheckResults checks={checks} label={label} status={verification.attributes.status} />
        )}
      </div>

      {isPhase5Verification(verification) && (
        <Section title="Evidence">
          <VerificationEvidence
            verification={verification}
            label={label}
            state={media}
            files={files}
            media={media}
            // C66: unknown when the card was not given them, so the chip evidence points instead.
            inquiryFiles={referenceFiles}
            // P024: its part titles are headings one below the card's h4.
            partHeadingLevel={5}
          />
        </Section>
      )}

      {verification.type === 'verification/selfie' ? (
        <SelfieSections
          verification={verification}
          label={label}
          files={files}
          media={media}
          showChecks={showChecks}
          captures={captures}
          referenceFiles={referenceFiles ?? []}
        />
      ) : (
        <FileSection
          label={label}
          files={files}
          media={media}
          // A government ID uploads images only; a Phase 5 type may hold a PDF or chip files.
          noun={isPhase5Verification(verification) ? 'files' : 'images'}
          shownInEvidence={evidencePreviewOf(verification, files)?.id}
        />
      )}
    </Card>
  );
}
