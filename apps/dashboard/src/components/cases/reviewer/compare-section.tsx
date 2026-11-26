/**
 * The compare panel (C142.3, editor note 7.5): the held inquiry's ID front (or its chip portrait,
 * read from the chip) beside its centre selfie, the side poses on request, with the similarity, the
 * threshold, its basis and the check's status exactly as the selfie card shows them, and the check's
 * tier and beta stage. Never "match" when the status says otherwise: the status is the check's own
 * word. Images are renditions through the console's proxy, and only for a reader with `pii:view`.
 */
import type {
  DashboardInquiryDocument,
  FileResource,
  SelfieCaptureResource,
} from '@openverify/contracts';
import { getCheckDefinition } from '@openverify/core';
import { thresholdText } from '../../check-results';
import { Detail } from '../../detail';
import { HiddenValue } from '../../masked-value';
import { StageBadge } from '../../reports/report-badges';
import { TierBadge } from '../../signals/evidence';
import { CheckStatusBadge } from '../../status-badge';
import { fileRenditionPath } from '../../verification-image';
import {
  THRESHOLD_ORIGIN_WORDS,
  capturesOf,
  consumedCapture,
  idComparisonOf,
  posePhotos,
  promptOrder,
  referenceFront,
  type SelfieVerification,
} from '../../../lib/selfie-evidence';
import { POSE_LABELS } from '../../../lib/selfie-words';
import { CompareViewer, type CompareImage } from './compare-viewer';

const CHECK = 'selfie_id_comparison';

const muted = (words: string) => <span className="text-ink-muted">{words}</span>;

const isFile = (resource: { type: string }): resource is FileResource => resource.type === 'file';
const isSelfie = (resource: { type: string }): resource is SelfieVerification =>
  resource.type === 'verification/selfie';
const isCapture = (resource: { type: string }): resource is SelfieCaptureResource =>
  resource.type === 'selfie';

/** The newest selfie verification of the inquiry and what the panel compares it with. */
function compared(document: DashboardInquiryDocument) {
  const included = document.included;
  const selfie = included
    .filter(isSelfie)
    .sort((a, b) => b.attributes['created-at'].localeCompare(a.attributes['created-at']))[0];
  if (selfie === undefined) {
    return null;
  }
  const files = included.filter(isFile);
  const selfieFiles = files.filter((file) => file.relationships.verification.data.id === selfie.id);
  const captures = capturesOf(included.filter(isCapture), selfie.id);
  const photos = posePhotos(
    promptOrder(selfie, consumedCapture(captures), selfieFiles),
    selfieFiles,
  );
  const comparison = idComparisonOf(selfie);
  const chipPortrait = files.filter((file) => file.attributes.kind === 'chip-portrait').at(-1);
  const compared = referenceFront(files, comparison.referenceId);
  // With no comparison naming a document, the newest front of any government ID, said as such.
  const newest =
    compared ??
    files
      .filter(
        (file) =>
          file.attributes.kind === 'front' &&
          file.relationships.verification.data.type === 'verification/government-id',
      )
      .at(-1);
  return { photos, comparison, chipPortrait, front: newest, frontCompared: compared !== undefined };
}

const imageOf = (file: FileResource, alt: string, caption: string): CompareImage => ({
  id: file.id,
  src: fileRenditionPath(file.id),
  alt,
  caption,
});

export function CompareSection({
  document,
  piiView,
}: {
  readonly document: DashboardInquiryDocument;
  readonly piiView: boolean;
}) {
  const found = compared(document);
  if (found === null) {
    return <p className="text-sm text-ink-muted">The held inquiry has no selfie to compare.</p>;
  }
  const { photos, comparison, chipPortrait, front, frontCompared } = found;
  const centre = photos.find((photo) => photo.pose === 'center')?.file;
  const reference =
    chipPortrait === undefined
      ? front === undefined
        ? undefined
        : imageOf(
            front,
            frontCompared
              ? 'Government ID front, whose portrait was compared'
              : 'Government ID front, not compared',
            'Government ID front',
          )
      : imageOf(chipPortrait, 'Chip portrait, read from the document', 'Chip portrait');
  const images = [
    ...(reference === undefined ? [] : [reference]),
    ...(centre === undefined
      ? []
      : [imageOf(centre, 'Selfie, centre pose', 'Selfie, centre pose')]),
  ];
  const extra = photos.flatMap((photo) => {
    if (photo.pose === 'center' || photo.file === undefined) {
      return [];
    }
    const words = `Selfie, ${POSE_LABELS[photo.pose].toLowerCase()} pose`;
    return [imageOf(photo.file, words, words)];
  });
  const definition = getCheckDefinition(CHECK);
  const { result, similarity, threshold } = comparison;
  return (
    <div className="flex flex-col gap-4">
      {piiView ? (
        <CompareViewer images={images} extra={extra} />
      ) : (
        <p className="text-sm">
          Images: <HiddenValue />
        </p>
      )}
      {reference !== undefined && chipPortrait === undefined && !frontCompared && (
        <p className="text-sm text-ink-muted">
          No comparison names a document, so this is the inquiry&apos;s newest government ID front;
          nothing compared it with the selfie.
        </p>
      )}
      {reference !== undefined && chipPortrait === undefined && (
        <p className="text-xs text-ink-muted">
          The API serves no portrait box of the document, so the front is shown whole; zoom in to
          the portrait by hand.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Detail term="Similarity">
          {similarity === null ? (
            muted('Not measured')
          ) : (
            <span className="font-mono">{similarity.toFixed(4)}</span>
          )}
        </Detail>
        <Detail term="Threshold">
          {threshold === null ? (
            muted('Not recorded')
          ) : (
            <span className="font-mono">{thresholdText(threshold.value)}</span>
          )}
        </Detail>
        <Detail term="Threshold basis">
          {threshold === null ? muted('Not recorded') : THRESHOLD_ORIGIN_WORDS[threshold.origin]}
        </Detail>
        <Detail term="Result">
          {result === undefined ? muted('Not run') : <CheckStatusBadge status={result.status} />}
        </Detail>
      </dl>
      {definition !== undefined && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <TierBadge tier={definition.tier} />
          {definition.stage === 'beta' && <StageBadge stage="beta" />}
          <span>{definition.description}</span>
        </p>
      )}
    </div>
  );
}
