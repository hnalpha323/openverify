/**
 * The selfie evidence on the verification card and page (C40.10, C43, C47): the pose photos in
 * prompt order, the government ID photo beside the centre one with the similarity, the threshold
 * and its basis; the other C40.10 scores; what liveness recorded (its components and flags, in
 * words); the consumed capture's prompt timings; and the captures themselves. Everything is read
 * from the API data (`lib/selfie-evidence.ts`); no threshold or basis is the console's own. There
 * is no device data to show: the API serves none (C40.1).
 *
 * Alt texts name the pose or the document, never the person. Every status is a text badge, so
 * nothing is conveyed by colour alone.
 */
import type { FileResource, SelfieCaptureResource } from '@openverify/contracts';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { reasonText } from '../lib/check-reasons';
import {
  THRESHOLD_ORIGIN_WORDS,
  type AppliedThreshold,
  type IdComparison,
  type LivenessEvidence,
  type PosePhoto,
  type SelfieVerification,
} from '../lib/selfie-evidence';
import {
  CAPTURE_ERROR_TEXT,
  CAPTURE_METHOD_LABELS,
  CAPTURE_STATUS_LABELS,
  LIVENESS_COMPONENT_LABELS,
  LIVENESS_COMPONENT_STATUS_LABELS,
  LIVENESS_MODE_LABELS,
  POSE_LABELS,
  livenessFlagText,
  orderFollowedText,
  type LivenessComponentStatus,
} from '../lib/selfie-words';
import { SUMMARY_CLASS, thresholdText } from './check-results';
import { DataTable, type Column } from './data-table';
import { Detail } from './detail';
import { LINK_CLASS } from './link-styles';
import { EmptyValue, HiddenValue } from './masked-value';
import { Badge, CheckStatusBadge, type BadgeTone } from './status-badge';
import { Timestamp } from './timestamp';
import { VerificationImage, type VerificationMedia } from './verification-image';

const code = (value: string, className = '') => (
  <code className={`font-mono text-xs break-all ${className}`}>{value}</code>
);

/** A value the data does not have, in words. */
const absent = (words: string) => <span className="text-ink-muted">{words}</span>;

/** A word list lookup that never reads `Object.prototype`. */
function wordsOf<Key extends string>(
  words: Readonly<Record<Key, string>>,
  key: string,
): string | undefined {
  return Object.hasOwn(words, key) ? words[key as Key] : undefined;
}

const scoreText = (score: number | null) =>
  score === null ? absent('Not measured') : <span className="font-mono">{score.toFixed(4)}</span>;

function ThresholdValueText({ threshold }: { readonly threshold: AppliedThreshold | null }) {
  return threshold === null ? (
    absent('Not recorded')
  ) : (
    <span className="font-mono">{thresholdText(threshold.value)}</span>
  );
}

function ThresholdOriginText({ threshold }: { readonly threshold: AppliedThreshold | null }) {
  return threshold === null ? (
    absent('Not recorded')
  ) : (
    <>{THRESHOLD_ORIGIN_WORDS[threshold.origin]}</>
  );
}

/** Why nothing was compared, or why the comparison could not run, in words. */
function comparisonNote({ result, missing }: IdComparison): string | null {
  if (result === undefined) {
    return 'No ID comparison result.';
  }
  if (missing === 'government_id') {
    return 'Nothing compared: the inquiry has no government ID to compare with.';
  }
  if (missing === 'portrait') {
    return 'Nothing compared: no portrait was found on the government ID.';
  }
  if (result.status === 'passed' || result.status === 'failed' || result.reasons.length === 0) {
    return null;
  }
  return result.reasons.map((reason) => reasonText(reason)?.words ?? reason).join(', ');
}

/**
 * `selfie_id_comparison` beside the centre photo: the government ID photo (on the card in a
 * closed disclosure, since the government ID card above shows it), the similarity, the threshold
 * and its basis, and the result.
 */
function IdComparisonPanel({
  comparison,
  idFront,
  idImage,
  media,
  hiddenExplanation,
}: {
  readonly comparison: IdComparison;
  readonly idFront: FileResource | undefined;
  readonly idImage: 'shown' | 'disclosed';
  readonly media: VerificationMedia;
  readonly hiddenExplanation: string | undefined;
}) {
  const headingId = useId();
  const { result, similarity, threshold } = comparison;
  const note = comparisonNote(comparison);
  const image =
    idFront === undefined ? null : (
      <VerificationImage
        fileId={idFront.id}
        alt="Government ID front, whose portrait was compared"
        media={media}
        hiddenExplanation={hiddenExplanation}
        caption="Government ID front"
      />
    );
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="flex max-w-sm flex-col gap-3 rounded-lg border border-line p-3"
    >
      <p id={headingId} className="text-sm font-medium">
        Compared with the government ID
      </p>
      {image !== null &&
        (idImage === 'shown' ? (
          image
        ) : (
          <details>
            <summary className={SUMMARY_CLASS}>Show the government ID photo</summary>
            <div className="mt-2">{image}</div>
          </details>
        ))}
      <dl className="grid grid-cols-2 gap-3">
        <Detail term="Similarity">{scoreText(similarity)}</Detail>
        <Detail term="Threshold">
          <ThresholdValueText threshold={threshold} />
        </Detail>
        <Detail term="Threshold basis">
          <ThresholdOriginText threshold={threshold} />
        </Detail>
        <Detail term="Result">
          {result === undefined ? absent('Not run') : <CheckStatusBadge status={result.status} />}
        </Detail>
      </dl>
      {note !== null && <p className="text-sm text-ink-muted">{note}</p>}
    </div>
  );
}

/** A prompted pose without a photo, or whose photo the page cannot name ("Hidden"). */
function PhotoPlaceholder({
  caption,
  hidden,
  hiddenExplanation,
}: {
  readonly caption: ReactNode;
  readonly hidden: boolean;
  readonly hiddenExplanation: string | undefined;
}) {
  return (
    <figure className="flex flex-col gap-1">
      <div className="flex h-24 w-32 items-center justify-center rounded-lg border border-dashed border-line bg-canvas text-sm text-ink-muted">
        {hidden ? <HiddenValue explanation={hiddenExplanation} /> : 'No photo'}
      </div>
      <figcaption className="flex flex-col text-xs text-ink-muted">{caption}</figcaption>
    </figure>
  );
}

export interface SelfiePhotosProps {
  /** The verification's title ("Selfie", "Selfie, attempt 2"); names the list and alt texts. */
  readonly label: string;
  readonly photos: readonly PosePhoto[];
  readonly media: VerificationMedia;
  readonly hiddenExplanation?: string | undefined;
  /** The ID comparison shown beside the centre photo; `undefined` without check details. */
  readonly comparison?: IdComparison | undefined;
  /** The front of the government ID compared, when the operator can see the inquiry's files. */
  readonly idFront?: FileResource | undefined;
  /** `shown` on the verification page; `disclosed` on the card, where the ID card shows it. */
  readonly idImage: 'shown' | 'disclosed';
  /** Each caption names its file id (the verification page). */
  readonly showFileIds?: boolean;
  /**
   * Whether the poses' files are known. Without `inquiries:read` the page knows the file ids but
   * not their kinds, so each prompted pose shows the media state ("Hidden"), never "No photo".
   */
  readonly filesKnown?: boolean;
}

/**
 * The pose photos in prompt order, each labelled by its pose and its place in the prompts, with
 * the government ID comparison beside the centre photo.
 */
export function SelfiePhotos({
  label,
  photos,
  media,
  hiddenExplanation,
  comparison,
  idFront,
  idImage,
  showFileIds = false,
  filesKnown = true,
}: SelfiePhotosProps) {
  const prompted = photos.filter((photo) => photo.prompted).length;
  return (
    <ul aria-label={`${label} images`} className="flex flex-wrap items-start gap-4">
      {photos.map((photo, index) => {
        const pose = POSE_LABELS[photo.pose];
        const caption = (
          <>
            <span className="font-medium text-ink">{pose}</span>
            <span>
              {photo.prompted
                ? `Photo ${String(index + 1)} of ${String(prompted)}`
                : 'Not prompted'}
            </span>
            {showFileIds && photo.file !== undefined && code(photo.file.id)}
          </>
        );
        return (
          <li key={photo.pose} className="flex flex-wrap items-start gap-4">
            {photo.file === undefined ? (
              <PhotoPlaceholder
                caption={caption}
                hidden={!filesKnown}
                hiddenExplanation={hiddenExplanation}
              />
            ) : (
              <VerificationImage
                fileId={photo.file.id}
                alt={`${label}, ${pose.toLowerCase()}`}
                media={media}
                hiddenExplanation={hiddenExplanation}
                caption={caption}
              />
            )}
            {photo.pose === 'center' && comparison !== undefined && (
              <IdComparisonPanel
                comparison={comparison}
                idFront={idFront}
                idImage={idImage}
                media={media}
                hiddenExplanation={hiddenExplanation}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface ScoreRow {
  readonly id: string;
  readonly label: string;
  readonly score: number | null;
  readonly threshold: AppliedThreshold | null;
}

const SCORE_COLUMNS: readonly Column<ScoreRow>[] = [
  { id: 'score', header: 'Score', rowHeader: true, cell: (row) => row.label },
  { id: 'value', header: 'Value', cell: (row) => scoreText(row.score) },
  {
    id: 'threshold',
    header: 'Threshold',
    cell: (row) => <ThresholdValueText threshold={row.threshold} />,
  },
  {
    id: 'basis',
    header: 'Threshold basis',
    cell: (row) => <ThresholdOriginText threshold={row.threshold} />,
  },
];

/**
 * The C40.10 scores besides the ID similarity: each prompted side pose's similarity to the centre
 * (against `min-side-identity-cosine`), and the centre's passive liveness score (against
 * `min-passive-score`), with each threshold and its basis.
 */
export function SelfieScores({
  label,
  evidence,
}: {
  readonly label: string;
  readonly evidence: LivenessEvidence;
}) {
  const rows: ScoreRow[] = [
    ...evidence.sideSimilarities.map((side) => ({
      id: side.pose,
      label: `Similarity of the ${POSE_LABELS[side.pose].toLowerCase()} pose to the center`,
      score: side.score,
      threshold: side.threshold,
    })),
    { id: 'liveness', label: 'Passive liveness score of the center', ...evidence.livenessScore },
  ];
  return (
    <DataTable
      caption={`${label} scores`}
      captionHidden
      columns={SCORE_COLUMNS}
      rows={rows}
      getRowKey={(row) => row.id}
      emptyMessage="No scores."
    />
  );
}

const COMPONENT_TONES: Readonly<Record<LivenessComponentStatus, BadgeTone>> = {
  passed: 'success',
  failed: 'danger',
  not_requested: 'neutral',
  not_executed: 'neutral',
};

/** A liveness component's status as a text badge; one the console does not know as its code. */
function ComponentStatus({ status }: { readonly status: string | null }) {
  if (status === null) {
    return absent('Not recorded');
  }
  const words = wordsOf(LIVENESS_COMPONENT_STATUS_LABELS, status);
  if (words === undefined) {
    return code(status);
  }
  return (
    <Badge
      status={status}
      label={words}
      tone={COMPONENT_TONES[status as LivenessComponentStatus]}
    />
  );
}

/** One flag in words with its code; a flag the console does not know as its code. */
function Flag({ flag }: { readonly flag: string }) {
  const text = livenessFlagText(flag);
  if (text === undefined) {
    return code(flag);
  }
  return (
    <span className="flex flex-col">
      <span className="font-medium">{text.words}</span>
      {text.explanation !== undefined && (
        <span className="text-xs text-ink-muted">{text.explanation}</span>
      )}
      {code(flag, 'text-ink-muted')}
    </span>
  );
}

const poseWords = (pose: string) => wordsOf(POSE_LABELS, pose) ?? pose;

/**
 * What `selfie_liveness_detection` recorded (C43): its passive, active and integrity components,
 * whether the poses arrived in the prompted order, the side poses it judged, and every flag in
 * words. Order and timing flags only lower the confidence of a pass.
 */
export function LivenessSummary({
  label,
  evidence,
}: {
  readonly label: string;
  readonly evidence: LivenessEvidence;
}) {
  const flags = [
    ...evidence.integrityFlags,
    ...evidence.timingFlags,
    ...(evidence.testCaptureDevice ? ['test-capture-device'] : []),
  ];
  const { judgedPoses, orderFollowed } = evidence;
  return (
    <div role="group" aria-label={`${label} liveness`} className="flex flex-col gap-3">
      {evidence.result === undefined ? (
        <p className="text-sm text-ink-muted">Liveness did not run.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {evidence.components.map(({ component, status }) => (
              <Detail key={component} term={LIVENESS_COMPONENT_LABELS[component]}>
                <ComponentStatus status={status} />
              </Detail>
            ))}
            <Detail term="Prompt order">
              {orderFollowed === undefined
                ? absent('Not recorded')
                : orderFollowedText(orderFollowed)}
            </Detail>
            <Detail term="Side poses judged">
              {judgedPoses === null
                ? absent('Not recorded')
                : judgedPoses.length === 0
                  ? 'None'
                  : judgedPoses.map(poseWords).join(', ')}
            </Detail>
          </dl>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Flags</p>
            {flags.length === 0 ? (
              <p className="text-sm text-ink-muted">No flag recorded.</p>
            ) : (
              <ul aria-label={`${label} liveness flags`} className="flex flex-col gap-2 text-sm">
                {flags.map((flag) => (
                  <li key={flag}>
                    <Flag flag={flag} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

type PromptTiming = SelfieCaptureResource['attributes']['prompt-timings'][number];

const TIMING_COLUMNS: readonly Column<PromptTiming>[] = [
  { id: 'pose', header: 'Pose', rowHeader: true, cell: (timing) => POSE_LABELS[timing.pose] },
  {
    id: 'client',
    header: 'Client time (ms)',
    cell: (timing) =>
      timing['client-elapsed-ms'] === null ? (
        absent('Not sent')
      ) : (
        <span className="font-mono">{timing['client-elapsed-ms'].toLocaleString('en-US')}</span>
      ),
  },
  {
    id: 'received',
    header: 'Received (UTC)',
    cell: (timing) => <Timestamp value={timing['received-at']} />,
  },
];

/**
 * The consumed capture's `prompt-timings` (C40.1): the latest photo of each pose, with the
 * client's elapsed time since the capture was created and the server's receipt time.
 */
export function PromptTimings({
  label,
  capture,
}: {
  readonly label: string;
  readonly capture: SelfieCaptureResource | undefined;
}) {
  if (capture === undefined) {
    return (
      <p className="text-sm text-ink-muted">
        No capture: this selfie was taken without the capture protocol.
      </p>
    );
  }
  const timings = capture.attributes['prompt-timings'];
  if (timings.length === 0) {
    return <p className="text-sm text-ink-muted">No photo was received.</p>;
  }
  return (
    <DataTable
      caption={`${label} prompt timings`}
      captionHidden
      columns={TIMING_COLUMNS}
      rows={timings}
      getRowKey={(timing) => `${timing.pose}:${timing['received-at']}`}
      emptyMessage="No photo was received."
    />
  );
}

/** The consumed capture's method and liveness mode (C40.10), as terms of a `<dl>`. */
export function SelfieCaptureDetails({
  verification,
}: {
  readonly verification: SelfieVerification;
}) {
  const method = verification.attributes['capture-method'] ?? null;
  const liveness = verification.attributes.liveness ?? null;
  return (
    <>
      <Detail term="Capture method">
        {method === null ? absent('Not recorded') : CAPTURE_METHOD_LABELS[method]}
      </Detail>
      <Detail term="Liveness">
        {liveness === null ? absent('Not recorded') : LIVENESS_MODE_LABELS[liveness]}
      </Detail>
    </>
  );
}

const CAPTURE_TONES: Readonly<Record<SelfieCaptureResource['attributes']['status'], BadgeTone>> = {
  initiated: 'neutral',
  submitted: 'progress',
  processed: 'neutral',
  errored: 'attention',
};

/** What became of a capture: used, still running, still open, or why it was not used. */
function Outcome({ capture }: { readonly capture: SelfieCaptureResource }) {
  const { status } = capture.attributes;
  const errorCode = capture.attributes['error-code'];
  if (status === 'processed') {
    return <>Used for the checks</>;
  }
  if (status === 'submitted') {
    return <>Submitted; the checks are running</>;
  }
  if (status === 'initiated') {
    return <>Not submitted yet</>;
  }
  if (errorCode === null) {
    return absent('No reason recorded');
  }
  const text = CAPTURE_ERROR_TEXT[errorCode];
  return (
    <span className="flex flex-col">
      <span className="font-medium">{text.words}</span>
      {text.explanation !== undefined && (
        <span className="text-xs text-ink-muted">{text.explanation}</span>
      )}
      {code(errorCode, 'text-ink-muted')}
    </span>
  );
}

const time = (value: string | null) =>
  value === null ? <EmptyValue /> : <Timestamp value={value} />;

export interface SelfieCapturesProps {
  /** Newest first. */
  readonly captures: readonly SelfieCaptureResource[];
  readonly caption: string;
  /** A column naming each capture's verification, linked with `verifications:read`. */
  readonly verificationColumn?: 'linked' | 'plain' | undefined;
}

/**
 * Selfie captures (C40.1) in the order given (newest first): id, method, status, what became of
 * each (an errored one says why, in words, with its code), and its times.
 */
export function SelfieCaptures({ captures, caption, verificationColumn }: SelfieCapturesProps) {
  const columns: Column<SelfieCaptureResource>[] = [
    { id: 'id', header: 'Capture ID', rowHeader: true, cell: (capture) => code(capture.id) },
    ...(verificationColumn === undefined
      ? []
      : [
          {
            id: 'verification',
            header: 'Verification',
            cell: (capture: SelfieCaptureResource) => {
              const id = capture.relationships.verification.data.id;
              return verificationColumn === 'linked' ? (
                <Link href={`/verifications/${id}`} className={LINK_CLASS}>
                  {code(id)}
                </Link>
              ) : (
                code(id)
              );
            },
          },
        ]),
    {
      id: 'method',
      header: 'Method',
      cell: (capture) => CAPTURE_METHOD_LABELS[capture.attributes['capture-method']],
    },
    {
      id: 'status',
      header: 'Status',
      cell: (capture) => (
        <Badge
          status={capture.attributes.status}
          label={CAPTURE_STATUS_LABELS[capture.attributes.status]}
          tone={CAPTURE_TONES[capture.attributes.status]}
        />
      ),
    },
    { id: 'outcome', header: 'Outcome', cell: (capture) => <Outcome capture={capture} /> },
    {
      id: 'created',
      header: 'Created (UTC)',
      cell: (capture) => time(capture.attributes['created-at']),
    },
    {
      id: 'expires',
      header: 'Expires (UTC)',
      cell: (capture) => time(capture.attributes['expires-at']),
    },
    {
      id: 'submitted',
      header: 'Submitted (UTC)',
      cell: (capture) => time(capture.attributes['submitted-at']),
    },
  ];
  return (
    <DataTable
      caption={caption}
      captionHidden
      columns={columns}
      rows={captures}
      getRowKey={(capture) => capture.id}
      emptyMessage="No selfie captures."
    />
  );
}
