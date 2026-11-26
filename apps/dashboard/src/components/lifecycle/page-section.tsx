import type { ReactNode } from 'react';

/** A titled section of a detail page: a region named by its heading, with an optional lead. */
export function PageSection({
  id,
  title,
  description,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {description !== undefined && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}
