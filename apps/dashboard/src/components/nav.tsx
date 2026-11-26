'use client';

import { cx } from '@openverify/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId } from 'react';
import { currentNavHref, type NavGroup } from './nav-items';

function Group({ group, current: currentHref }: { group: NavGroup; current: string | null }) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1">
      <p id={labelId} className="px-3 text-xs font-semibold tracking-wide text-ink-muted uppercase">
        {group.label}
      </p>
      <ul aria-labelledby={labelId} className="flex flex-col">
        {group.items.map((item) => {
          const current = item.href === currentHref;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cx(
                  'block rounded-md px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  current
                    ? 'bg-canvas font-semibold text-ink'
                    : 'text-ink-muted hover:bg-canvas hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The console's side navigation, with the current section marked (`aria-current`). */
export function Nav({ groups }: { readonly groups: readonly NavGroup[] }) {
  const current = currentNavHref(usePathname(), groups);
  return (
    <nav
      aria-label="Console"
      className="flex shrink-0 flex-col gap-5 border-b border-line bg-surface px-3 py-4 md:w-56 md:border-e md:border-b-0"
    >
      {groups.map((group) => (
        <Group key={group.label} group={group} current={current} />
      ))}
    </nav>
  );
}
