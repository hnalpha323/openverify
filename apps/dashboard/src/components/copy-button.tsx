'use client';

import { Button } from '@openverify/ui';
import { useState } from 'react';

export interface CopyButtonProps {
  readonly value: string;
  /** Defaults to "Copy". */
  readonly label?: string;
}

/** Copies `value` to the clipboard and says whether it worked, in a polite live region. */
export function CopyButton({ value, label = 'Copy' }: CopyButtonProps) {
  const [message, setMessage] = useState('');

  return (
    <span className="inline-flex items-center gap-3">
      <Button
        variant="secondary"
        onClick={() => {
          // navigator.clipboard is missing outside secure contexts: that fails into the catch.
          Promise.resolve()
            .then(() => navigator.clipboard.writeText(value))
            .then(
              () => {
                setMessage('Copied to the clipboard.');
              },
              () => {
                setMessage('Copying failed. Select the text and copy it.');
              },
            );
        }}
      >
        {label}
      </Button>
      <span role="status" className="text-sm text-ink-muted">
        {message}
      </span>
    </span>
  );
}
