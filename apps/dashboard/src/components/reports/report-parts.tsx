/**
 * Pieces the report views share (C86): a labelled list under a small heading, a value in a
 * report's PII state (shown, "Hidden" without `pii:view`, "Redacted" once redacted), a code, and
 * a plain timestamp or em dash.
 */
import { useId, type ReactNode } from 'react';
import { RedactedValue } from '../lifecycle/redacted-value';
import { EmptyValue, MaskedValue, type DisplayValue } from '../masked-value';
import { Timestamp } from '../timestamp';

/** How a report's personal values show: the API masks them without `pii:view` (C70.3). */
export type PiiState = 'visible' | 'hidden' | 'redacted';

/** A personal value in its state: "Redacted" once redacted, "Hidden" when masked. */
export function PersonalValue({
  value,
  state,
}: {
  readonly value: DisplayValue;
  readonly state: PiiState;
}) {
  if (state === 'redacted' && (value === null || value === undefined)) {
    return <RedactedValue />;
  }
  return <MaskedValue value={value} masked={state === 'hidden'} />;
}

export const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className="font-mono text-xs break-all">{children}</code>
);

/** A timestamp in UTC, or an em dash. */
export function TimeOrNone({ value }: { readonly value: string | null | undefined }) {
  return value === null || value === undefined ? <EmptyValue /> : <Timestamp value={value} />;
}

/** A list under its own small heading, which names it for assistive tech. */
export function LabelledList({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <h3 id={id} className="text-sm font-semibold text-ink">
        {title}
      </h3>
      <ul aria-labelledby={id} className="flex list-disc flex-col gap-1 ps-5 text-sm">
        {children}
      </ul>
    </div>
  );
}
