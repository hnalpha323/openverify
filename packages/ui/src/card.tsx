import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { hasContent } from './aria';
import { cx } from './cx';

export interface CardProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  /** Heading that also names the card as a landmark region. */
  title?: ReactNode;
  /** Heading level for the title, so screens keep a correct outline. Defaults to 2. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

/** A surface for grouped content. With a title it is a named `region` landmark. */
export function Card({ title, headingLevel = 2, className, children, ...props }: CardProps) {
  const id = useId();
  const hasTitle = hasContent(title);
  const headingId = `${id}-title`;
  const Heading = `h${String(headingLevel)}` as `h${typeof headingLevel}`;

  return (
    <section
      aria-labelledby={hasTitle ? headingId : undefined}
      className={cx('rounded-xl border border-line bg-surface p-6 shadow-sm', className)}
      {...props}
    >
      {hasTitle && (
        <Heading id={headingId} className="mb-4 text-xl font-semibold text-ink">
          {title}
        </Heading>
      )}
      {children}
    </section>
  );
}
