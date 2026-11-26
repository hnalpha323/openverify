/**
 * The pieces the Phase 5 evidence views share (C66): a personal value exactly as the API sent it,
 * a value a check did not record, words with their explanation (or the code itself when the
 * console has no words for it), and the type's "What a pass means" line. Each stays a server
 * component; `HiddenValue`, inside `MaskedValue`, is the only client part.
 */
import type { WordsText } from '../../lib/selfie-words';
import { RedactedValue } from '../lifecycle/redacted-value';
import { MaskedValue } from '../masked-value';
import type { EvidenceState, PartHeadingLevel } from './generic';

/**
 * A personal value exactly as this verification answer has it (C53.7): "Hidden" when the API
 * masked it for an operator without `pii:view`, "Redacted" after the inquiry's redaction, "None"
 * when there is none. The console never unmasks and reads it from nowhere else.
 */
export function PersonalValue({
  value,
  state,
}: {
  readonly value: string | null | undefined;
  readonly state: EvidenceState;
}) {
  if (state === 'redacted' && (value === null || value === undefined)) {
    return <RedactedValue />;
  }
  return <MaskedValue value={value} masked={state === 'hidden'} />;
}

/** What a check did not record: "Not recorded yet" before the checks ran, else "Not recorded". */
export function NotRecorded({ ran }: { readonly ran: boolean }) {
  return <span className="text-ink-muted">{ran ? 'Not recorded' : 'Not recorded yet'}</span>;
}

/** A code, an id or a value without words, in monospace. */
export function Code({ children }: { readonly children: string }) {
  return <code className="font-mono text-xs break-all">{children}</code>;
}

/** Words with their explanation beneath; a value the console has no words for, as its code. */
export function Words({
  text,
  code,
}: {
  readonly text: WordsText | undefined;
  readonly code: string;
}) {
  if (text === undefined) {
    return <Code>{code}</Code>;
  }
  return (
    <span className="flex flex-col">
      <span>{text.words}</span>
      {text.explanation !== undefined && (
        <span className="text-xs text-ink-muted">{text.explanation}</span>
      )}
    </span>
  );
}

/** C66: what a passed verification of the type means, in the words of its `docs/checks` page. */
export function PassMeans({ text }: { readonly text: string }) {
  return (
    <p className="text-sm text-ink-muted">
      <span className="font-medium text-ink">What a pass means: </span>
      <span>{text}</span>
    </p>
  );
}

/**
 * The title of one part of an evidence (Workflow 5C review P024, WCAG 1.3.1): a heading at
 * `level`, one below the section holding the evidence, so its terms and tables have their context
 * and a reader can move between parts; plain text when the host gives no level.
 */
export function PartTitle({
  title,
  level,
}: {
  readonly title: string;
  readonly level: PartHeadingLevel | undefined;
}) {
  return level === undefined ? (
    <p className="text-sm font-semibold">{title}</p>
  ) : (
    <p role="heading" aria-level={level} className="text-sm font-semibold">
      {title}
    </p>
  );
}
