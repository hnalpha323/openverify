import type { ReactNode } from 'react';

/** One term and its value inside a `<dl>`. */
export function Detail({
  term,
  children,
}: {
  readonly term: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-ink-muted">{term}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}
