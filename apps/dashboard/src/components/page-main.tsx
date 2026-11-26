import { cx } from '@openverify/ui';
import type { ReactNode } from 'react';

export interface PageMainProps {
  readonly children: ReactNode;
  /** `wide` (the default) for lists and details, `narrow` for forms and messages. */
  readonly width?: 'wide' | 'narrow';
  readonly className?: string;
}

/** The `<main>` of a console page, with the console's widths and spacing. */
export function PageMain({ children, width = 'wide', className }: PageMainProps) {
  return (
    <main
      className={cx(
        'mx-auto flex w-full flex-col gap-6 px-6 py-10',
        width === 'wide' ? 'max-w-6xl' : 'max-w-3xl',
        className,
      )}
    >
      {children}
    </main>
  );
}
