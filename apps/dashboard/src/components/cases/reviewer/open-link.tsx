'use client';

import { useId, useState } from 'react';
import { LINK_CLASS } from '../../link-styles';

/**
 * An address a commenter wrote, as text, with an "Open link" control that shows its host before the
 * link itself (C134.3): nothing typed into a comment becomes a link the reader follows without
 * seeing where it goes.
 */
export function OpenLink({ address, host }: { readonly address: string; readonly host: string }) {
  const [shown, setShown] = useState(false);
  const panel = useId();
  return (
    <>
      <span className="break-all">{address}</span>{' '}
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={panel}
        onClick={() => {
          setShown((current) => !current);
        }}
        className="inline-flex min-h-6 min-w-6 items-center rounded px-1 text-xs font-medium text-ink-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Open link
      </button>
      <span id={panel} className="ms-1 text-xs">
        {shown && (
          <>
            This link goes to <strong>{host}</strong>.{' '}
            <a
              href={address}
              className={LINK_CLASS}
              rel="noopener noreferrer nofollow"
              target="_blank"
            >
              Go to {host}
            </a>
          </>
        )}
      </span>
    </>
  );
}
