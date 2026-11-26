/** In place of a value or image that a redaction removed for good (C16). */
export function RedactedValue() {
  return (
    <span className="rounded bg-canvas px-1.5 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-line ring-inset">
      Redacted
    </span>
  );
}
