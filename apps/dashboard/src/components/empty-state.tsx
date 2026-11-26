import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** What is missing, such as "No webhooks yet". */
  readonly title: string;
  /** Why, or what it is for. */
  readonly children?: ReactNode;
  /** What to do about it, such as a link to create one. */
  readonly action?: ReactNode;
  readonly headingLevel?: 2 | 3;
}

/** A list or section with nothing in it yet (C23: every page has an empty state). */
export function EmptyState({ title, children, action, headingLevel = 2 }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-line bg-surface p-8">
      <Heading className="text-base font-semibold text-ink">{title}</Heading>
      {children !== undefined && <p className="text-sm text-ink-muted">{children}</p>}
      {action}
    </div>
  );
}
