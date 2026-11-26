/**
 * A run's values as the API served them (C120.6, C120.8, C120.9): a masked value arrives `null`
 * and stays hidden; the run's own dates say when `null` means purged or redacted instead. The
 * console never unmasks and never shows `null` as an empty value.
 */
export interface RunValueFacts {
  readonly redactedAt: string | null;
  readonly valuesPurgedAt: string | null;
}

export function RunValue({
  value,
  facts,
}: {
  readonly value: unknown;
  readonly facts: RunValueFacts;
}) {
  if (value === null || value === undefined) {
    if (facts.redactedAt !== null) {
      return <span>Redacted</span>;
    }
    if (facts.valuesPurgedAt !== null) {
      return <span>Purged by retention</span>;
    }
    return <span>Hidden without pii:view</span>;
  }
  if (typeof value === 'object' && Object.keys(value).length === 0) {
    return <span>None</span>;
  }
  return (
    <pre className="max-w-full overflow-x-auto rounded bg-surface-muted p-2 font-mono text-xs whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
