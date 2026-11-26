import {
  PII_VERIFICATION_ATTRIBUTES,
  type FileResource,
  type VerificationResource,
} from '@openverify/contracts';
import type { ReactNode } from 'react';
import { Detail } from '../detail';
import { RedactedValue } from '../lifecycle/redacted-value';
import { EmptyValue, MaskedValue, type DisplayValue } from '../masked-value';
import type { VerificationMedia } from '../verification-image';

/** A Phase 5 verification (C50.1): every type but a government ID and a selfie. */
export type Phase5Verification = Exclude<
  VerificationResource,
  { type: 'verification/government-id' | 'verification/selfie' }
>;

/**
 * How a verification's personal data may be shown: `visible` with `pii:view`; `hidden` without
 * it, the API having masked every PII attribute to `null` (C53.7); `redacted` once the inquiry
 * was redacted (C16).
 */
export type EvidenceState = 'visible' | 'hidden' | 'redacted';

/** What every evidence component receives (C54.5). */
export interface EvidenceProps {
  readonly verification: Phase5Verification;
  /** The verification's title ("Database", "Database, attempt 2"); names its regions. */
  readonly label: string;
  readonly state: EvidenceState;
  /**
   * C66: the verification's own files, when the card or the page knows them (a document's
   * preview and original, a chip portrait), to show through the file proxy. `null` when the
   * verification has files the page cannot tell apart (their kinds are in the inquiry document,
   * which needs `inquiries:read`): a type then never says a file was not stored (Workflow 6B
   * P5-3). Without them (`undefined`), a type leaves its files to the files section.
   */
  readonly files?: readonly FileResource[] | null | undefined;
  /** C66: how those files' images may show (`VerificationImage`). */
  readonly media?: VerificationMedia | undefined;
  /**
   * C66: the inquiry's files, when the card or the page knows them (the selfie centre photo a
   * chip portrait was compared with). `undefined` when they are unknown, so a type points to
   * where they are shown instead of saying there are none.
   */
  readonly inquiryFiles?: readonly FileResource[] | undefined;
  /**
   * Workflow 5C review P024 (WCAG 1.3.1): the level of the headings that title the evidence's
   * parts, one below the section holding it: 5 on the card (under its h4), 3 on the page (under
   * its h2). Without it the titles stay plain text.
   */
  readonly partHeadingLevel?: PartHeadingLevel | undefined;
}

/** The heading levels an evidence part may take. */
export type PartHeadingLevel = 3 | 4 | 5 | 6;

/** The attributes every verification has, which the card and the view show on their own. */
const COMMON_ATTRIBUTES: ReadonlySet<string> = new Set([
  'status',
  'checks',
  'from-rejected-handoff',
  'created-at',
  'updated-at',
]);

const PII: ReadonlySet<string> = new Set(PII_VERIFICATION_ATTRIBUTES);

/** The words of an attribute name that are acronyms. */
const ACRONYMS: ReadonlyMap<string, string> = new Map([
  ['id', 'ID'],
  ['lei', 'LEI'],
  ['url', 'URL'],
  ['mime', 'MIME'],
  ['evm', 'EVM'],
  ['aamva', 'AAMVA'],
]);

/** `registry-record-id` → "Registry record ID". */
function termOf(name: string): string {
  const words = name.split('-').map((word) => ACRONYMS.get(word) ?? word);
  const [first = '', ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * One value as the API sent it. Inside personal data (`personal`), a `null` is what the masking
 * left: "Hidden" without `pii:view`, "Redacted" after a redaction. Objects list their members,
 * lists their entries, so nothing is shown as raw JSON.
 */
function Value({
  value,
  personal,
  state,
}: {
  readonly value: unknown;
  readonly personal: boolean;
  readonly state: EvidenceState;
}): ReactNode {
  if (personal && state === 'redacted' && (value === null || value === undefined)) {
    return <RedactedValue />;
  }
  if (Array.isArray(value)) {
    const entries: readonly unknown[] = value;
    return entries.length === 0 ? (
      <EmptyValue />
    ) : (
      <ul className="flex flex-col gap-2">
        {entries.map((entry, index) => (
          // The entries have no identity of their own; their order is the API's.
          <li key={index}>
            <Value value={entry} personal={personal} state={state} />
          </li>
        ))}
      </ul>
    );
  }
  if (isRecord(value)) {
    return <Members members={value} personal={personal} state={state} />;
  }
  // What is left of a JSON answer: a string, a number, a flag or `null`.
  return <MaskedValue value={value as DisplayValue} masked={personal && state === 'hidden'} />;
}

function Members({
  members,
  personal,
  state,
}: {
  readonly members: Record<string, unknown>;
  readonly personal: boolean;
  readonly state: EvidenceState;
}) {
  return (
    <dl className="grid grid-cols-1 gap-2 border-l border-line pl-3 sm:grid-cols-2">
      {Object.entries(members).map(([name, value]) => (
        <Detail key={name} term={termOf(name)}>
          <Value value={value} personal={personal} state={state} />
        </Detail>
      ))}
    </dl>
  );
}

/**
 * C54.5: the generic evidence of a Phase 5 verification: each type attribute in the API's
 * order, named in words, with the value exactly as this verification answer has it (dates are
 * strings, never parsed). The API masks personal data per operator (C53.7), so a masked value
 * reads "Hidden" without `pii:view` and "Redacted" after a redaction; the console masks nothing
 * itself and reads no value from anywhere else. Each type's own component (Workflow 5C) replaces
 * this view through its placeholder in `components/evidence/<type>.tsx`.
 */
export function GenericEvidence({ verification, label, state }: EvidenceProps) {
  const attributes = Object.entries<unknown>(verification.attributes).filter(
    ([name]) => !COMMON_ATTRIBUTES.has(name),
  );
  if (attributes.length === 0) {
    return <p className="text-sm text-ink-muted">Nothing recorded yet.</p>;
  }
  return (
    <div role="group" aria-label={`${label} evidence`}>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {attributes.map(([name, value]) => (
          <Detail key={name} term={termOf(name)}>
            <Value value={value} personal={PII.has(name)} state={state} />
          </Detail>
        ))}
      </dl>
    </div>
  );
}
