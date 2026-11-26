import type { FileKind } from '@openverify/contracts';
import { Alert, Button } from '@openverify/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rememberCaptureMethod } from '../lib/capture-methods';
import { IMAGE_INPUT_ACCEPT, checkImageFile, type ImageFileError } from '../lib/image-file';
import type { PhotoProblem } from '../lib/photo-check';
import { CameraCapture, type CaptureGuideShape } from './camera-capture';
import { PhotoPreview } from './photo-preview';

export type CaptureMethod = 'camera' | 'upload';

export interface CaptureShot {
  readonly kind: FileKind;
  readonly title: string;
  readonly instruction: string;
  /** Alternative text of the preview. */
  readonly previewAlt: string;
  /** Accessible name of the file picker, when uploads are allowed. */
  readonly uploadLabel: string;
  readonly methods: readonly CaptureMethod[];
  readonly camera: {
    readonly facingMode: 'user' | 'environment';
    readonly guide: CaptureGuideShape;
    readonly mirrored: boolean;
    /** Phase 12A F4: an ID's back, framed for its barcode. */
    readonly barcode?: boolean;
  };
}

/**
 * Phase 12A F3: the prompts for one photo after which "use this photo anyway" is offered, so a
 * check that is wrong about a photo never blocks the user.
 */
export const PROMPTS_BEFORE_USE_ANYWAY = 2;

export type CapturedPhotos = readonly (readonly [FileKind, Blob])[];

export interface CaptureSequenceProps {
  readonly shots: readonly CaptureShot[];
  readonly onComplete: (photos: CapturedPhotos) => void;
}

type Mode =
  | { readonly name: 'choose' }
  | { readonly name: 'camera' }
  | {
      readonly name: 'preview';
      readonly photo: Blob;
      readonly source: CaptureMethod;
      /** Phase 12A F3: why the check asks for a retake, for a camera photo. */
      readonly problem?: PhotoProblem;
    };

/** Where keyboard and screen-reader focus goes after a mode change. */
type FocusTarget = 'title' | 'camera-button' | 'upload-button';

/** Walks the user through each photo: take or upload it, preview it, retake or use it. */
export function CaptureSequence({ shots, onComplete }: CaptureSequenceProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [photos, setPhotos] = useState<CapturedPhotos>([]);
  const [mode, setMode] = useState<Mode>({ name: 'choose' });
  const [fileError, setFileError] = useState<ImageFileError | null>(null);
  /** Phase 12A F3: the retake prompts the current photo has had. */
  const [prompts, setPrompts] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const cameraButton = useRef<HTMLButtonElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const focusAfterChange = useRef<FocusTarget | null>(null);
  const shot = shots[index];

  // Moving to the next photo: put screen-reader and keyboard focus on its title.
  useEffect(() => {
    if (index > 0) {
      heading.current?.focus();
    }
  }, [index]);

  // A mode change unmounts the control that caused it, so focus would fall back to the page:
  // move it to the photo's title, or back to the button the user came from.
  useEffect(() => {
    const target = focusAfterChange.current;
    focusAfterChange.current = null;
    if (target === 'title') {
      heading.current?.focus();
    } else if (target === 'camera-button') {
      cameraButton.current?.focus();
    } else if (target === 'upload-button') {
      uploadButton.current?.focus();
    }
  }, [mode]);

  const changeMode = (next: Mode, focus: FocusTarget) => {
    focusAfterChange.current = focus;
    setMode(next);
  };

  if (shot === undefined) {
    return null;
  }

  const chooseFile = async (file: File | undefined) => {
    if (file === undefined) {
      return;
    }
    const check = await checkImageFile(file);
    if (check.ok) {
      setFileError(null);
      changeMode({ name: 'preview', photo: file, source: 'upload' }, 'title');
    } else {
      setFileError(check.error);
    }
  };

  const accept = (photo: Blob, source: CaptureMethod) => {
    // C153.2: the upload reports how the photo was taken (client-reported guidance).
    rememberCaptureMethod(photo, source);
    const next = [...photos, [shot.kind, photo] as const];
    if (index + 1 >= shots.length) {
      onComplete(next);
      return;
    }
    setPhotos(next);
    setIndex(index + 1);
    setPrompts(0);
    setMode({ name: 'choose' });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {shots.length > 1 && (
          <p className="text-sm font-medium text-ink-muted">
            {t('capture.progress', { current: index + 1, total: shots.length })}
          </p>
        )}
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
          {shot.title}
        </h2>
        <p>{shot.instruction}</p>
      </div>

      {mode.name === 'choose' && (
        <div className="flex flex-col gap-4">
          {fileError !== null && <Alert tone="error">{t(`capture.fileErrors.${fileError}`)}</Alert>}
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            {shot.methods.includes('upload') && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept={IMAGE_INPUT_ACCEPT}
                  aria-label={shot.uploadLabel}
                  // Opened by the button below; hidden so assistive tech meets one control.
                  hidden
                  onChange={(event) => {
                    const input = event.currentTarget;
                    const [file] = input.files ?? [];
                    // Clear the input so choosing the same file again still fires a change.
                    input.value = '';
                    void chooseFile(file);
                  }}
                />
                <Button
                  ref={uploadButton}
                  variant={shot.methods.includes('camera') ? 'secondary' : 'primary'}
                  onClick={() => fileInput.current?.click()}
                >
                  {t('capture.uploadPhoto')}
                </Button>
              </>
            )}
            {shot.methods.includes('camera') && (
              <Button
                ref={cameraButton}
                onClick={() => {
                  setFileError(null);
                  changeMode({ name: 'camera' }, 'title');
                }}
              >
                {t('capture.takePhoto')}
              </Button>
            )}
          </div>
        </div>
      )}

      {mode.name === 'camera' && (
        <CameraCapture
          {...shot.camera}
          onCapture={(photo, check) => {
            const problem = check?.problem ?? null;
            if (problem === null) {
              changeMode({ name: 'preview', photo, source: 'camera' }, 'title');
            } else {
              setPrompts((count) => count + 1);
              changeMode({ name: 'preview', photo, source: 'camera', problem }, 'title');
            }
          }}
          onCancel={() => {
            changeMode({ name: 'choose' }, 'camera-button');
          }}
        />
      )}

      {/* Stays mounted, so the photo to check is announced as it appears. */}
      <p role="status" data-testid="capture-announcement" className="sr-only">
        {mode.name === 'preview' && mode.problem === undefined ? t('capture.photoReady') : ''}
      </p>

      {mode.name === 'preview' && (
        <PhotoPreview
          photo={mode.photo}
          alt={shot.previewAlt}
          problem={mode.problem ?? null}
          allowAnyway={prompts > PROMPTS_BEFORE_USE_ANYWAY}
          onRetake={() => {
            if (mode.source === 'camera') {
              changeMode({ name: 'camera' }, 'title');
            } else {
              changeMode({ name: 'choose' }, 'upload-button');
            }
          }}
          onAccept={() => {
            accept(mode.photo, mode.source);
          }}
        />
      )}
    </div>
  );
}
