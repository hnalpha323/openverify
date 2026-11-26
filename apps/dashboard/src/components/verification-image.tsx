import type { ReactNode } from 'react';
import { RedactedValue } from './lifecycle/redacted-value';
import { HiddenValue } from './masked-value';
import { RenditionImage } from './rendition-image';

/**
 * How the images can be shown: `visible` through the file proxy; `hidden` when the operator lacks
 * `pii:view` or `inquiries:read` (C15: the content answers 403); `redacted` once the inquiry is
 * redacted (C16: 410).
 */
export type VerificationMedia = 'visible' | 'hidden' | 'redacted';

/** The dashboard's own route that streams a file through the API with the session cookie. */
export function fileContentPath(id: string): string {
  return `/files/${encodeURIComponent(id)}/content`;
}

/**
 * The dashboard's route that streams a file's rendition (C135.3, decision 63): the image re-encoded
 * without metadata, which every image view shows. The content route stays for downloads (a PDF).
 */
export function fileRenditionPath(id: string): string {
  return `/files/${encodeURIComponent(id)}/rendition`;
}

/**
 * One uploaded image as the media allow it: its rendition through the file proxy (C135.3), with a
 * "preparing" placeholder while it is made, or "Hidden" or "Redacted".
 */
export function VerificationImage({
  fileId,
  alt,
  media,
  caption,
  hiddenExplanation,
}: {
  readonly fileId: string;
  readonly alt: string;
  readonly media: VerificationMedia;
  readonly caption: ReactNode;
  /** Why a `hidden` image is hidden, when not for want of `pii:view` (Workflow 2E E001). */
  readonly hiddenExplanation?: string | undefined;
}) {
  return (
    <figure className="flex flex-col gap-1">
      {media === 'visible' ? (
        <RenditionImage
          src={fileRenditionPath(fileId)}
          alt={alt}
          className="h-48 w-auto max-w-full rounded-lg border border-line bg-canvas object-contain"
        />
      ) : (
        <div className="flex h-24 w-32 items-center justify-center rounded-lg border border-dashed border-line bg-canvas">
          {media === 'hidden' ? <HiddenValue explanation={hiddenExplanation} /> : <RedactedValue />}
        </div>
      )}
      <figcaption className="flex flex-col text-xs text-ink-muted">{caption}</figcaption>
    </figure>
  );
}
