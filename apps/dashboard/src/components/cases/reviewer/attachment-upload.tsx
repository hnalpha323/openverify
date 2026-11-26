'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type SubmitEvent } from 'react';
import { controlClassName } from '../../form-field';
import { SubmitButton } from '../../submit-button';

/** C135.2 (decision 62): what the API types by its magic bytes, and what the picker offers. */
export const ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
/** C135.1: at most 10 MiB a file. */
export const ATTACHMENT_MAX_BYTES = 10 * 1_048_576;

type Upload =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'done' }
  | { readonly kind: 'refused'; readonly message: string };

/**
 * An attachment upload (C135.1, C142.7): the file goes to the console's streaming route
 * (`/cases/:id/attachments`), never through a server action, whose 1 MB limit a 10 MiB file would
 * pass. The route checks the session and the origin itself and answers a sentence of ours; the
 * outcome is said politely (4.1.3), and the page reloads its attachments after a success.
 */
export function AttachmentUpload({
  caseId,
  remaining,
}: {
  readonly caseId: string;
  /** How many more files the template's policy allows on this case. */
  readonly remaining: number;
}) {
  const router = useRouter();
  const inputId = useId();
  const statusId = useId();
  const [upload, setUpload] = useState<Upload>({ kind: 'idle' });

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem('file');
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (file === undefined || file.size === 0) {
      setUpload({ kind: 'refused', message: 'Choose a file to upload.' });
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setUpload({ kind: 'refused', message: 'The file is larger than 10 MiB.' });
      return;
    }
    setUpload({ kind: 'sending' });
    try {
      const body = new FormData();
      body.set('file', file);
      const response = await fetch(`/cases/${encodeURIComponent(caseId)}/attachments`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });
      if (response.status === 201) {
        form.reset();
        setUpload({ kind: 'done' });
        router.refresh();
        return;
      }
      setUpload({ kind: 'refused', message: (await response.text()) || 'The upload failed.' });
    } catch {
      setUpload({ kind: 'refused', message: 'The upload could not be sent: try again.' });
    }
  };

  if (remaining <= 0) {
    return (
      <p className="text-sm text-ink-muted">
        This case holds as many files as its template allows.
      </p>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex flex-col gap-2"
      encType="multipart/form-data"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-sm font-medium text-ink">
            File
          </label>
          <input
            id={inputId}
            name="file"
            type="file"
            accept={ATTACHMENT_ACCEPT}
            required
            aria-describedby={statusId}
            className={controlClassName({})}
          />
        </div>
        <SubmitButton
          variant="secondary"
          pendingLabel="Uploading…"
          pending={upload.kind === 'sending'}
        >
          Upload
        </SubmitButton>
      </div>
      <p id={statusId} role="status" aria-live="polite" className="text-sm text-ink-muted">
        {upload.kind === 'done'
          ? 'The file was uploaded. It is scanned and prepared before it can be viewed.'
          : upload.kind === 'refused'
            ? upload.message
            : `JPEG, PNG, WebP or PDF, at most 10 MiB; ${String(remaining)} more allowed.`}
      </p>
    </form>
  );
}
