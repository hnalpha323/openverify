/**
 * C54.5, C60, C66: the `verification/document` evidence on the verification card and page. It
 * shows what a pass means; the page-1 preview through the authenticated file route and the
 * original PDF as a download only (when the card or page passes the files); the class with its
 * confidence, which is uncalibrated and `beta`, and the class probabilities; the extracted fields
 * as the API masked them; the dates; the comparisons; and the fabrication score with every
 * component in words (H tier, `beta`, advisory by default). Everything is read from the
 * verification answer (`lib/document-evidence.ts`); no threshold is the console's own.
 *
 * Statuses are text badges, so nothing is conveyed by colour alone; a `not_applicable` result is
 * never shown as a pass, and an advisory one says it does not decide the verification. The
 * preview's alt text names the page, never the person.
 */
import type { VerificationCheck } from '@openverify/contracts';
import type { ReactNode } from 'react';
import { reasonText } from '../../lib/check-reasons';
import {
  documentEvidenceOf,
  documentOriginalOf,
  documentPreviewOf,
  type ClassProbability,
  type ComparisonEvidence,
  type DocumentEvidenceData,
  type DocumentEvidenceProps,
  type FabricationComponent,
} from '../../lib/document-evidence';
import {
  CUE_STRENGTH_LABELS,
  DATE_FLAG_TEXT,
  DOCUMENT_CLASS_LABELS,
  DOCUMENT_FIELD_LABELS,
  DOCUMENT_PASS_MEANS,
  FABRICATION_CUE_TEXT,
  ISSUE_DATE_SOURCE_LABELS,
  LAYOUT_FEATURE_LABELS,
  MATCH_LEVEL_LABELS,
  REFERENCE_SOURCE_LABELS,
  UNKNOWN_REASON_TEXT,
  languageName,
  wordsFor,
} from '../../lib/document-words';
import { DataTable, type Column } from '../data-table';
import { Detail } from '../detail';
import { RedactedValue } from '../lifecycle/redacted-value';
import { LINK_CLASS } from '../link-styles';
import { HiddenValue, MaskedValue } from '../masked-value';
import { CheckStatusBadge } from '../status-badge';
import { VerificationImage, fileContentPath, type VerificationMedia } from '../verification-image';
import { GenericEvidence, type EvidenceState, type PartHeadingLevel } from './generic';
import { PartTitle } from './parts';

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;
const muted = (words: string) => <span className="text-ink-muted">{words}</span>;
const fixed = (value: number, digits = 2) => (
  <span className="font-mono">{value.toFixed(digits)}</span>
);
const capitalised = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** A result's stage when it is `beta` (ADR 0002 §3c), as the checks table labels it. */
function BetaLabel() {
  return (
    <span
      data-stage="beta"
      className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ink ring-1 ring-control ring-inset"
    >
      Beta
    </span>
  );
}

/** A check's status, whether it decides the verification, its stage and its reasons in words. */
function Outcome({ result }: { readonly result: VerificationCheck | undefined }) {
  if (result === undefined) {
    return muted('Not run');
  }
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex flex-wrap items-center gap-1">
        <CheckStatusBadge status={result.status} />
        {result.stage === 'beta' && <BetaLabel />}
        <span className="text-xs text-ink-muted">
          {result.requirement === 'required'
            ? 'Required'
            : 'Advisory: it does not decide the verification'}
        </span>
      </span>
      {result.reasons.length > 0 && (
        <span className="text-xs">
          {result.reasons
            .map((reason) => reasonText(reason, result.name)?.words ?? reason)
            .join(', ')}
        </span>
      )}
    </span>
  );
}

/** One part of the evidence: its title (a heading at `level`, P024) above its terms or table. */
function Part({
  title,
  level,
  children,
}: {
  readonly title: string;
  readonly level: PartHeadingLevel | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <PartTitle title={title} level={level} />
      {children}
    </div>
  );
}

const TERMS_CLASS = 'grid grid-cols-1 gap-4 sm:grid-cols-3';

/** The preview inline through the file route, and the original: a PDF only as a download. */
function DocumentFiles({
  data,
  files,
  verificationId,
  media,
  level,
}: {
  readonly data: DocumentEvidenceData;
  readonly files: NonNullable<DocumentEvidenceProps['files']>;
  readonly verificationId: string;
  readonly media: VerificationMedia;
  readonly level: PartHeadingLevel | undefined;
}) {
  const preview = documentPreviewOf(files, verificationId);
  const original = documentOriginalOf(files, verificationId);
  const pdf = (original?.attributes['mime-type'] ?? data.mimeType) === 'application/pdf';
  let originalValue: ReactNode;
  if (original === undefined) {
    originalValue = muted('No upload recorded');
  } else if (!pdf) {
    originalValue = 'The original photo is shown with the files.';
  } else if (media === 'hidden') {
    originalValue = <HiddenValue />;
  } else if (media === 'redacted') {
    originalValue = <RedactedValue />;
  } else {
    originalValue = (
      <span className="flex flex-col gap-1">
        <a href={fileContentPath(original.id)} download className={LINK_CLASS}>
          Download the original PDF
        </a>
        <span className="text-xs text-ink-muted">
          The PDF downloads as a file; the console never opens it in the browser.
        </span>
      </span>
    );
  }
  return (
    <Part title="The document" level={level}>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Detail term="Preview">
          {preview === undefined ? (
            muted('No preview was stored')
          ) : (
            <VerificationImage
              fileId={preview.id}
              alt="Document preview, page 1"
              media={media}
              caption="Page 1, as the server rendered it"
            />
          )}
        </Detail>
        <Detail term="Original">{originalValue}</Detail>
      </dl>
    </Part>
  );
}

function probabilityColumns(): readonly Column<ClassProbability>[] {
  return [
    {
      id: 'class',
      header: 'Class',
      rowHeader: true,
      cell: (row) => DOCUMENT_CLASS_LABELS[row.classification],
    },
    { id: 'probability', header: 'Probability', cell: (row) => fixed(row.probability, 4) },
  ];
}

function ClassPart({
  data,
  label,
  level,
}: {
  readonly data: DocumentEvidenceData;
  readonly label: string;
  readonly level: PartHeadingLevel | undefined;
}) {
  const evidence = data.documentClass;
  const { classification, confidence, language, script, identityDocument, unknownReason } =
    evidence;
  return (
    <Part title="Class" level={level}>
      <dl className={TERMS_CLASS}>
        <Detail term="Class">
          {classification === null ? muted('Not recorded') : DOCUMENT_CLASS_LABELS[classification]}
        </Detail>
        <Detail term="Type check">
          <Outcome result={evidence.result} />
        </Detail>
        <Detail term="Confidence">
          {confidence === null ? (
            muted('Not recorded')
          ) : (
            <span className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-1">
                {fixed(confidence, 4)}
                {evidence.result?.stage === 'beta' && <BetaLabel />}
              </span>
              <span className="text-xs text-ink-muted">
                The top class probability of our own rules, uncalibrated: not a measured accuracy.
              </span>
            </span>
          )}
        </Detail>
        <Detail term="Minimum confidence">
          {evidence.minConfidence === null ? muted('Not recorded') : fixed(evidence.minConfidence)}
        </Detail>
        <Detail term="Language">
          {language === null ? muted('Not established') : languageName(language)}
        </Detail>
        <Detail term="Script">
          {script === null ? muted('Not established') : capitalised(script)}
        </Detail>
        <Detail term="Identity document">
          {identityDocument === null ? muted('Not recorded') : identityDocument ? 'Yes' : 'No'}
        </Detail>
        <Detail term="Accepted classes">
          {evidence.acceptedTypes.length === 0
            ? muted('Not recorded')
            : evidence.acceptedTypes.map((value) => DOCUMENT_CLASS_LABELS[value]).join(', ')}
        </Detail>
        <Detail term="Layout features">
          {evidence.features.length === 0
            ? muted('None found')
            : evidence.features
                .map((feature) => wordsFor(LAYOUT_FEATURE_LABELS, feature) ?? feature)
                .join(', ')}
        </Detail>
        {unknownReason !== null && (
          <Detail term="Why not recognised">
            {wordsFor(UNKNOWN_REASON_TEXT, unknownReason) ?? code(unknownReason)}
          </Detail>
        )}
        <Detail term="Pages">
          {data.pageCount === null ? muted('Not recorded') : String(data.pageCount)}
        </Detail>
        <Detail term="Media type">
          {data.mimeType === null ? muted('Not recorded') : code(data.mimeType)}
        </Detail>
      </dl>
      {evidence.probabilities.length > 0 && (
        <DataTable
          caption={`${label} class probabilities`}
          columns={probabilityColumns()}
          rows={evidence.probabilities}
          getRowKey={(row) => row.classification}
          emptyMessage="No probabilities recorded."
        />
      )}
    </Part>
  );
}

function FieldsPart({
  data,
  state,
  level,
}: {
  readonly data: DocumentEvidenceData;
  readonly state: EvidenceState;
  readonly level: PartHeadingLevel | undefined;
}) {
  const { fields } = data;
  if (fields === null) {
    return (
      <Part title="Extracted fields" level={level}>
        <dl>
          <Detail term="Extracted fields">
            {state === 'redacted' ? (
              <RedactedValue />
            ) : state === 'hidden' ? (
              <HiddenValue />
            ) : (
              muted('No fields were extracted.')
            )}
          </Detail>
        </dl>
      </Part>
    );
  }
  return (
    <Part title="Extracted fields" level={level}>
      <dl className={TERMS_CLASS}>
        {fields.map(([field, value]) => (
          <Detail key={field} term={DOCUMENT_FIELD_LABELS[field]}>
            {state === 'redacted' && value === null ? (
              <RedactedValue />
            ) : (
              <MaskedValue value={value} masked={state === 'hidden'} />
            )}
          </Detail>
        ))}
      </dl>
    </Part>
  );
}

function DatesPart({
  data,
  level,
}: {
  readonly data: DocumentEvidenceData;
  readonly level: PartHeadingLevel | undefined;
}) {
  const { dates } = data;
  const window =
    dates.maxAgeMonths !== null
      ? `Within ${String(dates.maxAgeMonths)} months`
      : dates.maxAgeDays !== null
        ? `Within ${String(dates.maxAgeDays)} days`
        : null;
  return (
    <Part title="Dates" level={level}>
      <dl className={TERMS_CLASS}>
        <Detail term="Recency">
          <span className="flex flex-col gap-1">
            <Outcome result={dates.recency} />
            {window !== null && <span className="text-xs">{window}</span>}
          </span>
        </Detail>
        <Detail term="Issue date read from">
          {dates.dateSource === null
            ? muted('Not recorded')
            : (wordsFor(ISSUE_DATE_SOURCE_LABELS, dates.dateSource) ?? code(dates.dateSource))}
        </Detail>
        <Detail term="Expiry">
          <Outcome result={dates.expiry} />
        </Detail>
        {dates.flags.length > 0 && (
          <Detail term="Date notes">
            {dates.flags.map((flag) => wordsFor(DATE_FLAG_TEXT, flag) ?? flag).join('; ')}
          </Detail>
        )}
      </dl>
    </Part>
  );
}

function Comparison({ comparison }: { readonly comparison: ComparisonEvidence }) {
  const { level, referenceSource } = comparison;
  return (
    <span className="flex flex-col gap-1">
      <Outcome result={comparison.result} />
      {level !== null && (
        <span className="text-xs">{wordsFor(MATCH_LEVEL_LABELS, level) ?? level}</span>
      )}
      {referenceSource !== null && (
        <span className="text-xs">
          Reference: {wordsFor(REFERENCE_SOURCE_LABELS, referenceSource) ?? referenceSource}
        </span>
      )}
    </span>
  );
}

function cueColumns(): readonly Column<FabricationComponent>[] {
  return [
    {
      id: 'cue',
      header: 'Cue',
      rowHeader: true,
      cell: (row) => {
        const text = wordsFor(FABRICATION_CUE_TEXT, row.id);
        return text === undefined ? (
          code(row.id)
        ) : (
          <span className="flex flex-col">
            <span className="font-medium">{text.words}</span>
            {text.explanation !== undefined && (
              <span className="text-xs text-ink-muted">{text.explanation}</span>
            )}
          </span>
        );
      },
    },
    {
      id: 'strength',
      header: 'Strength',
      cell: (row) => (row.strength === null ? muted('Unknown') : CUE_STRENGTH_LABELS[row.strength]),
    },
    { id: 'weight', header: 'Weight', cell: (row) => fixed(row.weight) },
    {
      id: 'signal',
      header: 'Signal',
      cell: (row) => (row.signal === 0 ? 'Not seen' : fixed(row.signal)),
    },
    { id: 'contribution', header: 'Contribution', cell: (row) => fixed(row.contribution) },
  ];
}

function FabricationPart({
  data,
  label,
  level,
}: {
  readonly data: DocumentEvidenceData;
  readonly label: string;
  readonly level: PartHeadingLevel | undefined;
}) {
  const { fabrication } = data;
  const { result } = fabrication;
  const number = (value: number | null) => (value === null ? muted('Not recorded') : fixed(value));
  return (
    <Part title="Fabrication (a heuristic)" level={level}>
      <dl className={TERMS_CLASS}>
        <Detail term="Fabrication">
          <Outcome result={result} />
        </Detail>
        {result !== undefined && (
          <>
            <Detail term="Score">{number(fabrication.score)}</Detail>
            <Detail term="Fails above">{number(fabrication.maxScore)}</Detail>
            <Detail term="Weak cues count at most">{number(fabrication.weakCueCap)}</Detail>
            <Detail term="Fabrication confidence">{number(result.confidence ?? null)}</Detail>
          </>
        )}
      </dl>
      <p className="text-xs text-ink-muted">
        A clean score is no proof that a document is genuine: the cues are traces of common edits,
        and a document made from scratch carries none.
      </p>
      {result !== undefined && (
        <DataTable
          caption={`${label} fabrication cues`}
          columns={cueColumns()}
          rows={fabrication.components}
          getRowKey={(row) => row.id}
          emptyMessage="No cue was measured."
        />
      )}
    </Part>
  );
}

/** The `verification/document` evidence (C66). */
export function DocumentEvidence(props: DocumentEvidenceProps) {
  const { verification, label, state, files } = props;
  if (verification.type !== 'verification/document') {
    return <GenericEvidence verification={verification} label={label} state={state} />;
  }
  const data = documentEvidenceOf(verification);
  const level = props.partHeadingLevel;
  return (
    <div role="group" aria-label={`${label} evidence`} className="flex flex-col gap-6">
      <p className="text-sm">
        <span className="font-semibold">What a pass means. </span>
        {DOCUMENT_PASS_MEANS}
      </p>
      {/* Workflow 6B P5-3: files the page cannot tell apart (`null`) are left to the files too. */}
      {files !== undefined && files !== null && (
        <DocumentFiles
          data={data}
          files={files}
          verificationId={verification.id}
          media={props.media ?? state}
          level={level}
        />
      )}
      <ClassPart data={data} label={label} level={level} />
      <FieldsPart data={data} state={state} level={level} />
      <DatesPart data={data} level={level} />
      <Part title="Comparisons" level={level}>
        <dl className={TERMS_CLASS}>
          <Detail term="Name comparison">
            <Comparison comparison={data.name} />
          </Detail>
          <Detail term="Address comparison">
            <Comparison comparison={data.address} />
          </Detail>
        </dl>
      </Part>
      <FabricationPart data={data} label={label} level={level} />
    </div>
  );
}
