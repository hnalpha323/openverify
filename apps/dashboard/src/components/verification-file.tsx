import type { ReactNode } from 'react';

/** Whether a file of `mimeType` is an image the console can show (C52.4: not a PDF or chip file). */
export function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * A file the console does not show as an image (C54.5): a PDF document or a chip file, named by
 * its kind, its media type and its ID. Neither reveals personal data, so it shows in every state.
 */
export function NonImageFile({
  kind,
  mimeType,
  caption,
}: {
  readonly kind: string;
  readonly mimeType: string;
  readonly caption: ReactNode;
}) {
  return (
    <figure className="flex flex-col gap-1">
      <div className="flex h-24 w-32 flex-col items-center justify-center gap-0.5 rounded-lg border border-line bg-canvas px-2 text-center">
        <span className="text-xs font-medium">{kind}</span>
        <code className="font-mono text-[0.65rem] break-all text-ink-muted">{mimeType}</code>
      </div>
      <figcaption className="flex flex-col text-xs text-ink-muted">{caption}</figcaption>
    </figure>
  );
}

/**
 * A file the verification's evidence already shows (Workflow 6B P5-2: a document's preview),
 * named in the files by its kind, media type and ID instead of being shown a second time.
 */
export function FileShownInEvidence({
  kind,
  mimeType,
  fileId,
}: {
  readonly kind: string;
  readonly mimeType: string;
  readonly fileId: string;
}) {
  return (
    <NonImageFile
      kind={kind}
      mimeType={mimeType}
      caption={
        <>
          <span>Shown with the evidence</span>
          <code className="font-mono break-all">{fileId}</code>
        </>
      }
    />
  );
}
