'use client';

import { Button } from '@openverify/ui';
import { useId, type ReactNode } from 'react';
import { CopyButton } from './copy-button';
import { Dialog } from './dialog';

export interface OneTimeSecretDialogProps {
  readonly open: boolean;
  readonly title: string;
  /** Names the secret, such as "Token" or "Recovery codes". */
  readonly label: string;
  /** One secret, or a list of codes copied together. */
  readonly secret: string | readonly string[];
  /** The owner drops the secret here: it lives only as long as the dialog. */
  readonly onClose: () => void;
  readonly description?: ReactNode;
  /** Shown above the secret, such as a QR code. */
  readonly children?: ReactNode;
}

const ONCE = 'This is the only time it is shown. Copy it now and keep it somewhere safe.';

/**
 * Shows a secret the API returns once: an API key token, a webhook secret, a TOTP secret,
 * recovery codes or a one-time link (C21). It is never written to a URL, storage or a log; the
 * owner keeps it in component state and drops it in `onClose`.
 */
export function OneTimeSecretDialog({
  open,
  title,
  label,
  secret,
  onClose,
  description = ONCE,
  children,
}: OneTimeSecretDialogProps) {
  const id = useId();

  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} size="lg">
      {children}
      {typeof secret === 'string' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-sm font-medium text-ink">
            {label}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              id={id}
              readOnly
              value={secret}
              spellCheck={false}
              autoComplete="off"
              onFocus={(event) => {
                event.currentTarget.select();
              }}
              className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 font-mono text-sm text-ink"
            />
            <CopyButton value={secret} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ul
            aria-label={label}
            className="grid grid-cols-2 gap-2 rounded-md border border-line bg-canvas p-4 font-mono text-sm"
          >
            {secret.map((item) => (
              <li key={item}>
                <code>{item}</code>
              </li>
            ))}
          </ul>
          <CopyButton value={secret.join('\n')} label="Copy all" />
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Dialog>
  );
}
