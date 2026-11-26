import { Alert, Button } from '@openverify/ui';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PhotoProblem } from '../lib/photo-check';

export interface PhotoPreviewProps {
  readonly photo: Blob;
  /** Describes what the photo should show, e.g. "Your photo of the front of your ID". */
  readonly alt: string;
  readonly onRetake: () => void;
  readonly onAccept: () => void;
  /**
   * Phase 12A F3: why the check before upload asks for a retake. The photo is then not offered
   * for use, unless `allowAnyway` (after two prompts for the same photo) offers it anyway.
   */
  readonly problem?: PhotoProblem | null;
  readonly allowAnyway?: boolean;
}

/** Shows a captured or chosen photo so the user can retake it or use it. */
export function PhotoPreview({
  photo,
  alt,
  onRetake,
  onAccept,
  problem = null,
  allowAnyway = false,
}: PhotoPreviewProps) {
  const { t } = useTranslation();
  const image = useRef<HTMLImageElement>(null);

  // A blob: URL for the photo, set before paint and released when the photo changes or the
  // preview goes away (also correct when StrictMode runs the effect twice).
  useLayoutEffect(() => {
    const url = URL.createObjectURL(photo);
    if (image.current !== null) {
      image.current.src = url;
    }
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [photo]);

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl border border-line bg-canvas">
        <img ref={image} alt={alt} className="mx-auto max-h-96 w-full object-contain" />
      </div>
      {problem === null ? (
        <p className="text-sm text-ink-muted">{t('capture.checkPhoto')}</p>
      ) : (
        <Alert tone="warning">{t(`capture.photoCheck.${problem}`)}</Alert>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {problem === null ? (
          <>
            <Button variant="secondary" onClick={onRetake}>
              {t('capture.retake')}
            </Button>
            <Button onClick={onAccept}>{t('capture.usePhoto')}</Button>
          </>
        ) : (
          <>
            {allowAnyway && (
              <Button variant="secondary" onClick={onAccept}>
                {t('capture.photoCheck.useAnyway')}
              </Button>
            )}
            <Button onClick={onRetake}>{t('capture.retake')}</Button>
          </>
        )}
      </div>
    </div>
  );
}
