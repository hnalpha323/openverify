/**
 * C54.5, C62, C66: the `verification/government-id-nfc` evidence on the verification card and
 * page. It shows what a pass means; the chip portrait beside the selfie centre photo it was
 * compared with (when the card or page passes the files; the console serves no raw chip file);
 * DG1's fields as the API masked them; passive authentication with its integrity apart from its
 * revocation, the trust anchor's source (a sandbox-only anchor labelled so), how the anchor was
 * chosen and how the signer's certificate stood; the data-group table; Active Authentication; the
 * device report as the client's own claim, never evidence; the MRZ and selfie comparisons;
 * earlier sightings as a count; and the expiry. Everything is read from the verification answer
 * (`lib/government-id-nfc-evidence.ts`); no threshold is the console's own. A verification read
 * from a sandbox test chip is labelled "Test chip (sandbox)" first, with its scenario (C208.4).
 *
 * Statuses are text badges, so nothing is conveyed by colour alone; a `not_applicable` result is
 * never shown as a pass, and an advisory one says it does not decide the verification. Alt texts
 * name the image, never the person.
 */
import type { VerificationCheck } from '@openverify/contracts';
import type { ReactNode } from 'react';
import { reasonText } from '../../lib/check-reasons';
import { wordsFor } from '../../lib/document-words';
import {
  chipEvidenceOf,
  chipPortraitOf,
  selfieCenterOf,
  type ChipEvidenceData,
  type ChipEvidenceProps,
  type DataGroupRow,
  type PassiveAuthenticationEvidence,
  type SignerValidity,
} from '../../lib/government-id-nfc-evidence';
import {
  AA_SCHEME_LABELS,
  ACTIVE_AUTHENTICATION_TEXT,
  ANCHOR_MATCH_LABELS,
  CHIP_INTEGRITY_TEXT,
  CHIP_REVOCATION_TEXT,
  DATA_GROUP_STATE_TEXT,
  DEVICE_PROTOCOL_LABELS,
  DEVICE_REPORT_NOTE,
  MRZ_COMPARED_FIELD_LABELS,
  NFC_PASS_MEANS,
  PASSIVE_AUTHENTICATION_FLAG_TEXT,
  REVOCATION_GAP_LABELS,
  SANDBOX_ANCHOR_NOTE,
  SANDBOX_CHIP_LABEL,
  SANDBOX_CHIP_NOTE,
  dataGroupLabel,
} from '../../lib/government-id-nfc-words';
import { EXTRACTION_FIELD_LABELS } from '../../lib/labels';
import { DataTable, type Column } from '../data-table';
import { Detail } from '../detail';
import { RedactedValue } from '../lifecycle/redacted-value';
import { MaskedValue } from '../masked-value';
import { CheckStatusBadge } from '../status-badge';
import { VerificationImage, type VerificationMedia } from '../verification-image';
import { GenericEvidence, type EvidenceState, type PartHeadingLevel } from './generic';
import { PartTitle } from './parts';

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;
const muted = (words: string) => <span className="text-ink-muted">{words}</span>;
const note = (words: string) => <span className="text-xs text-ink-muted">{words}</span>;
const TERMS_CLASS = 'grid grid-cols-1 gap-4 sm:grid-cols-3';

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

/** Words and their sentence. */
function Worded({ text }: { readonly text: { words: string; explanation?: string } | undefined }) {
  if (text === undefined) {
    return muted('Not recorded');
  }
  return (
    <span className="flex flex-col gap-0.5">
      <span>{text.words}</span>
      {text.explanation !== undefined && note(text.explanation)}
    </span>
  );
}

const SIGNER_VALIDITY_WORDS: Readonly<Record<SignerValidity, string>> = Object.freeze({
  valid: 'Valid at verification time',
  expired: 'Outside its validity at verification time',
  profile_invalid: 'Its profile is invalid for a document signer',
  missing: 'No signer certificate',
  not_judged: 'Not judged: integrity was not established',
});

function SignerCertificate({ evidence }: { readonly evidence: PassiveAuthenticationEvidence }) {
  if (evidence.integrity === null) {
    return muted('Not recorded');
  }
  return <>{SIGNER_VALIDITY_WORDS[evidence.signerValidity]}</>;
}

function Revocation({ evidence }: { readonly evidence: PassiveAuthenticationEvidence }) {
  const { revocation, revocationGap, revocationMode } = evidence;
  return (
    <span className="flex flex-col gap-0.5">
      <Worded text={revocation === null ? undefined : CHIP_REVOCATION_TEXT[revocation]} />
      {revocationGap !== null &&
        note(wordsFor(REVOCATION_GAP_LABELS, revocationGap) ?? revocationGap)}
      {revocationMode === 'strict' && note('Strict: an undetermined revocation goes to review.')}
      {revocationMode === 'best-effort' &&
        note('Best-effort: an undetermined revocation is accepted, flagged.')}
    </span>
  );
}

function AnchorSource({ evidence }: { readonly evidence: PassiveAuthenticationEvidence }) {
  if (evidence.anchorSource === null) {
    return muted('No anchor recorded');
  }
  return (
    <span className="flex flex-col items-start gap-1">
      {code(evidence.anchorSource)}
      {evidence.anchorSandboxOnly === true && (
        <>
          <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ink ring-1 ring-control ring-inset">
            Sandbox-only
          </span>
          {note(SANDBOX_ANCHOR_NOTE)}
        </>
      )}
    </span>
  );
}

function dataGroupColumns(): readonly Column<DataGroupRow>[] {
  return [
    {
      id: 'group',
      header: 'Data group',
      rowHeader: true,
      cell: (row) => dataGroupLabel(row.key),
    },
    {
      id: 'state',
      header: 'State',
      cell: (row) => {
        const text = wordsFor(DATA_GROUP_STATE_TEXT, row.state);
        return text === undefined ? code(row.state) : <Worded text={text} />;
      },
    },
  ];
}

function PassiveAuthenticationPart({
  data,
  label,
  level,
}: {
  readonly data: ChipEvidenceData;
  readonly label: string;
  readonly level: PartHeadingLevel | undefined;
}) {
  const evidence = data.passiveAuthentication;
  const { integrity, anchorMatchedBy, hashAlgorithm, signatureAlgorithm, flags } = evidence;
  return (
    <Part title="Passive authentication" level={level}>
      <dl className={TERMS_CLASS}>
        <Detail term="Passive authentication">
          <Outcome result={evidence.result} />
        </Detail>
        <Detail term="Integrity">
          <Worded text={integrity === null ? undefined : CHIP_INTEGRITY_TEXT[integrity]} />
        </Detail>
        <Detail term="Revocation">
          <Revocation evidence={evidence} />
        </Detail>
        <Detail term="Trust anchor source">
          <AnchorSource evidence={evidence} />
        </Detail>
        <Detail term="Anchor chosen">
          {anchorMatchedBy === null ? (
            muted('Not recorded')
          ) : (
            <span className="flex flex-col gap-0.5">
              <span>{wordsFor(ANCHOR_MATCH_LABELS, anchorMatchedBy) ?? anchorMatchedBy}</span>
              {evidence.anchorLink === true && note('Through a link certificate')}
            </span>
          )}
        </Detail>
        <Detail term="Signer certificate">
          <SignerCertificate evidence={evidence} />
        </Detail>
        <Detail term="Hash algorithm">
          {hashAlgorithm === null ? muted('Not recorded') : code(hashAlgorithm)}
        </Detail>
        <Detail term="Signature algorithm">
          {signatureAlgorithm === null ? muted('Not recorded') : code(signatureAlgorithm)}
        </Detail>
        <Detail term="Flags">
          {flags.length === 0
            ? muted('None')
            : flags
                .map((flag) => wordsFor(PASSIVE_AUTHENTICATION_FLAG_TEXT, flag) ?? flag)
                .join('; ')}
        </Detail>
      </dl>
      <DataTable
        caption={`${label} data groups`}
        columns={dataGroupColumns()}
        rows={evidence.dataGroups}
        getRowKey={(row) => row.key}
        emptyMessage="No data group was recorded."
      />
    </Part>
  );
}

function ActiveAuthenticationPart({
  data,
  level,
}: {
  readonly data: ChipEvidenceData;
  readonly level: PartHeadingLevel | undefined;
}) {
  const evidence = data.activeAuthentication;
  const { outcome, scheme, required, deviceReported } = evidence;
  return (
    <Part title="Active Authentication" level={level}>
      <dl className={TERMS_CLASS}>
        <Detail term="Chip authentication">
          <Outcome result={evidence.result} />
        </Detail>
        <Detail term="Active Authentication">
          {outcome === null ? (
            muted('Not recorded')
          ) : (
            <Worded text={wordsFor(ACTIVE_AUTHENTICATION_TEXT, outcome) ?? { words: outcome }} />
          )}
        </Detail>
        <Detail term="Scheme">
          {scheme === null ? muted('Not reached') : (wordsFor(AA_SCHEME_LABELS, scheme) ?? scheme)}
        </Detail>
        <Detail term="Required by the template">
          {required === null ? muted('Not recorded') : required ? 'Yes' : 'No'}
        </Detail>
        <Detail term="Device report">
          <span className="flex flex-col gap-0.5">
            <span>
              {deviceReported.length === 0
                ? 'Nothing reported'
                : deviceReported
                    .map((protocol) => wordsFor(DEVICE_PROTOCOL_LABELS, protocol) ?? protocol)
                    .join(', ')}
            </span>
            {note(DEVICE_REPORT_NOTE)}
          </span>
        </Detail>
      </dl>
    </Part>
  );
}

const fieldList = (fields: readonly string[]) =>
  fields.length === 0
    ? 'none'
    : fields.map((field) => wordsFor(MRZ_COMPARED_FIELD_LABELS, field) ?? field).join(', ');

function ComparisonsPart({
  data,
  level,
}: {
  readonly data: ChipEvidenceData;
  readonly level: PartHeadingLevel | undefined;
}) {
  const { mrz, selfie } = data;
  const basis = selfie.result?.provenance?.['threshold-basis']?.threshold;
  return (
    <Part title="Comparisons" level={level}>
      <dl className={TERMS_CLASS}>
        <Detail term="MRZ comparison">
          <span className="flex flex-col gap-0.5">
            <Outcome result={mrz.result} />
            {mrz.result !== undefined && (
              <>
                <span className="text-xs">Compared: {fieldList(mrz.compared)}</span>
                <span className="text-xs">Differs: {fieldList(mrz.mismatched)}</span>
                {mrz.confusablesTolerated === true &&
                  note('OCR confusables (0 and O, 1 and I) were tolerated in the printed MRZ.')}
              </>
            )}
          </span>
        </Detail>
        <Detail term="Selfie comparison">
          <Outcome result={selfie.result} />
        </Detail>
        <Detail term="Similarity">
          {selfie.similarity === null ? (
            muted('Not measured')
          ) : (
            <span className="font-mono">{selfie.similarity.toFixed(4)}</span>
          )}
        </Detail>
        <Detail term="Threshold">
          {selfie.threshold === null ? (
            muted('Not recorded')
          ) : (
            <span className="flex flex-col gap-0.5">
              <span className="font-mono">{selfie.threshold.toFixed(4)}</span>
              {basis === 'provisional' && note('Provisional: not calibrated for chip portraits.')}
              {basis === 'calibrated' && note('Calibrated.')}
            </span>
          )}
        </Detail>
      </dl>
    </Part>
  );
}

function PortraitPart({
  data,
  props,
  media,
  level,
}: {
  readonly data: ChipEvidenceData;
  readonly props: ChipEvidenceProps;
  readonly media: VerificationMedia;
  readonly level: PartHeadingLevel | undefined;
}) {
  const portrait =
    props.files === null || props.files === undefined
      ? undefined
      : chipPortraitOf(props.files, props.verification.id);
  const { selfieVerificationId } = data.selfie;
  const selfie = selfieCenterOf(props.inquiryFiles ?? [], selfieVerificationId);
  // Without the inquiry's files the selfie photo is unknown here, not absent: point to it.
  const selfieElsewhere =
    props.inquiryFiles === undefined ? (
      <span className="flex flex-col gap-0.5">
        <span>Shown with the selfie verification</span>
        {selfieVerificationId === null
          ? note('The comparison names no selfie verification.')
          : code(selfieVerificationId)}
      </span>
    ) : null;
  return (
    <Part title="Chip portrait and selfie" level={level}>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Detail term="Chip portrait">
          {props.files === null ? (
            // Workflow 6B P5-3: the kinds are unknown here, not the portrait absent: point to it.
            <span className="flex flex-col gap-0.5">
              <span>Listed with the files</span>
              {note('Which file it is needs the inquiries:read permission.')}
            </span>
          ) : portrait === undefined ? (
            muted('No chip portrait was stored (integrity or the portrait was not established).')
          ) : (
            <VerificationImage
              fileId={portrait.id}
              alt="Chip portrait"
              media={media}
              caption="Signed on the chip (DG2)"
            />
          )}
        </Detail>
        <Detail term="Selfie photo">
          {selfieElsewhere ??
            (selfie === undefined ? (
              muted('No selfie photo in the inquiry was compared.')
            ) : (
              <VerificationImage
                fileId={selfie.id}
                alt="Selfie centre photo the portrait was compared with"
                media={media}
                caption="The selfie’s centre photo"
              />
            ))}
        </Detail>
      </dl>
    </Part>
  );
}

function ChipDataPart({
  data,
  state,
  level,
}: {
  readonly data: ChipEvidenceData;
  readonly state: EvidenceState;
  readonly level: PartHeadingLevel | undefined;
}) {
  return (
    <Part title="Chip data (DG1)" level={level}>
      <dl className={TERMS_CLASS}>
        {data.fields.map(([field, value]) => (
          <Detail key={field} term={wordsFor(EXTRACTION_FIELD_LABELS, field) ?? field}>
            {state === 'redacted' && value === null ? (
              <RedactedValue />
            ) : (
              <MaskedValue value={value} masked={state === 'hidden'} />
            )}
          </Detail>
        ))}
        <Detail term="ID class">
          {data.idClass === null ? muted('Not recorded') : code(data.idClass)}
        </Detail>
        <Detail term="Issuing country">{data.issuingCountry ?? muted('Not recorded')}</Detail>
      </dl>
    </Part>
  );
}

/** The `verification/government-id-nfc` evidence (C66). */
export function GovernmentIdNfcEvidence(props: ChipEvidenceProps) {
  const { verification, label, state } = props;
  if (verification.type !== 'verification/government-id-nfc') {
    return <GenericEvidence verification={verification} label={label} state={state} />;
  }
  const data = chipEvidenceOf(verification);
  const { repeat, expiry } = data;
  const level = props.partHeadingLevel;
  return (
    <div role="group" aria-label={`${label} evidence`} className="flex flex-col gap-6">
      {data.sandboxChip !== null && (
        <p
          role="note"
          aria-label={SANDBOX_CHIP_LABEL}
          className="flex flex-col items-start gap-1 text-sm"
        >
          <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ink ring-1 ring-control ring-inset">
            {SANDBOX_CHIP_LABEL}
          </span>
          <span>Scenario: {code(data.sandboxChip)}</span>
          {note(SANDBOX_CHIP_NOTE)}
        </p>
      )}
      <p className="text-sm">
        <span className="font-semibold">What a pass means. </span>
        {NFC_PASS_MEANS}
      </p>
      {props.files !== undefined && (
        <PortraitPart data={data} props={props} media={props.media ?? state} level={level} />
      )}
      <ChipDataPart data={data} state={state} level={level} />
      <PassiveAuthenticationPart data={data} label={label} level={level} />
      <ActiveAuthenticationPart data={data} level={level} />
      <ComparisonsPart data={data} level={level} />
      <Part title="Reuse and expiry" level={level}>
        <dl className={TERMS_CLASS}>
          <Detail term="Repeat check">
            <Outcome result={repeat.result} />
          </Detail>
          <Detail term="Earlier sightings on other accounts">
            {repeat.sightings === null ? muted('Not counted') : String(repeat.sightings)}
          </Detail>
          <Detail term="Expiry">
            <Outcome result={expiry.result} />
          </Detail>
        </dl>
      </Part>
    </div>
  );
}
