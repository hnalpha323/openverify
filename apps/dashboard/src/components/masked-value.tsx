import { HiddenValue } from './hidden-value';

export { HiddenValue } from './hidden-value';

/** Missing data: an em dash on screen, "None" for screen readers. */
export function EmptyValue() {
  return (
    <>
      <span aria-hidden="true" className="text-ink-muted">
        —
      </span>
      <span className="sr-only">None</span>
    </>
  );
}

export type DisplayValue = string | number | boolean | null | undefined;

export interface MaskedValueProps {
  readonly value: DisplayValue;
  /**
   * Whether the API masks PII for this operator (no `pii:view`): a `null` value is then
   * "Hidden" rather than missing.
   */
  readonly masked: boolean;
}

/** A field value as the console shows it: "Hidden" when masked, an em dash when missing. */
export function MaskedValue({ value, masked }: MaskedValueProps) {
  if (masked && value === null) {
    return <HiddenValue />;
  }
  if (value === null || value === undefined || value === '') {
    return <EmptyValue />;
  }
  if (typeof value === 'boolean') {
    return <>{value ? 'Yes' : 'No'}</>;
  }
  return <>{String(value)}</>;
}
