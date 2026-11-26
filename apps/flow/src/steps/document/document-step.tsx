import {
  ACCEPTED_IMAGE_MIME_TYPES,
  maxUploadBytes,
  type FlowVerificationResource,
} from '@openverify/contracts';
import { Alert, Button, Card } from '@openverify/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../session/use-intl-locale';
import { useIsolatedT } from '../../i18n/bidi';
import { errorMessageKey } from '../../api/error-message';
import { FlowApiError, type CaptureMethod, type FlowApiClient } from '../../api/flow-api-client';
import { isConflict } from '../../api/problem-members';
import { RetryHints } from '../../components/retry-hints';
import { useFlowEnvironment } from '../../flow/flow-environment';
import type { DocumentStep as DocumentFlowStep, FlowPosition } from '../../flow/flow-position';
import { captureMethodsFor } from '../../lib/capture-methods';
import { newSubmissionProgress } from '../../flow/submit-verification';
import { useVerificationGuidance } from '../../flow/use-verification-guidance';
import {
  checkDocumentFile,
  formatFileSize,
  imageMimeTypes,
  type DocumentFileError,
  type DocumentMimeType,
} from '../../lib/document-file';

export interface DocumentStepProps {
  readonly position: Extract<FlowPosition, { kind: 'capture' }> & {
    readonly step: DocumentFlowStep;
  };
  readonly client: FlowApiClient;
  /** Reloads the session once the document is submitted, or moved on at the server. */
  readonly onSubmitted: () => Promise<void>;
}

type DocumentType = DocumentFlowStep['documentTypes'][number];

/** C52.2: the document step's guidance, when the attempt's resource carries some. */
type DocumentGuidance = NonNullable<
  Extract<FlowVerificationResource, { type: 'verification/document' }>['attributes']['guidance']
>;

/** The media types a document may be, a PDF first, until the guidance says which (C52.4). */
const ALL_MEDIA_TYPES: readonly DocumentMimeType[] = [
  'application/pdf',
  ...ACCEPTED_IMAGE_MIME_TYPES,
];

/** The formats' own names, the same in every language. */
const FORMAT_NAMES: Readonly<Record<DocumentMimeType, string>> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

/** C60.6: the classes that must be dated within the window (`max-age-days`). */
const DATED_TYPES: ReadonlySet<DocumentType> = new Set([
  'utility_bill',
  'bank_statement',
  'pay_stub',
]);

function guidanceOf(verification: FlowVerificationResource | undefined): DocumentGuidance | null {
  return verification?.type === 'verification/document'
    ? (verification.attributes.guidance ?? null)
    : null;
}

/** The file the user picked: its bytes typed by their content, its own name shown on the device. */
interface PickedDocument {
  readonly blob: Blob;
  readonly name: string;
  readonly size: number;
  /** C153.2: the input it came from, reported with the upload. */
  readonly method: CaptureMethod;
}

type Phase =
  | { readonly name: 'choose' }
  | { readonly name: 'sending' }
  /** The last try failed; while Try again runs (`retrying`), this screen and its focus stay. */
  | { readonly name: 'failed'; readonly error: unknown; readonly retrying: boolean };

/** A refusal of the picked file: the browser's own, or the server's (which takes focus). */
interface FileRefusal {
  readonly error: DocumentFileError;
  readonly fromServer: boolean;
}

const isHttp = (error: unknown, ...statuses: number[]): boolean =>
  error instanceof FlowApiError &&
  error.kind === 'http' &&
  error.status !== null &&
  statuses.includes(error.status);

/**
 * One attempt of a document step (C60, C64.1): the documents the step accepts, each with the
 * window the guidance gives, the formats and limits, then a file picker limited to the accepted
 * media types (and, when the step allows the camera, a photo from the back camera). A picked file
 * is checked in the browser, shown by its name and size only (a PDF is never rendered), then
 * uploaded as the type its bytes say and submitted. The attempt's verification is made when the
 * screen opens, so its guidance is read before the user picks a file (C52.2).
 */
export function DocumentStep({ position, client, onSubmitted }: DocumentStepProps) {
  const { t } = useTranslation();
  const intlTag = useIntlLocale();
  // C161.3 (Workflow 9A): every interpolated value in its own <bdi>.
  const tb = useIsolatedT();
  const language = intlTag;
  const { step, attempt, maxAttempts, hints, verificationId } = position;
  // One progress record per attempt, shared by the guidance read and the upload.
  const [progress] = useState(() => newSubmissionProgress(verificationId));
  const guided = useVerificationGuidance({
    client,
    type: 'document',
    progress,
    verification: position.verification,
  });
  const guidance = guidanceOf(guided.verification);
  const types = guidance?.['accepted-types'] ?? step.documentTypes;
  const mediaTypes = guidance?.['accepted-mime-types'] ?? ALL_MEDIA_TYPES;
  // C153.2: the methods of this device class.
  const { deviceKind } = useFlowEnvironment();
  const methods = captureMethodsFor(step, deviceKind);
  const cameraTypes = methods.includes('camera') ? imageMimeTypes(mediaTypes) : [];
  const formats = new Intl.ListFormat(language, { type: 'disjunction' }).format(
    mediaTypes.map((type) => FORMAT_NAMES[type]),
  );
  const sizeLimit = formatFileSize(maxUploadBytes('document'), language);

  const [picked, setPicked] = useState<PickedDocument | null>(null);
  const [refusal, setRefusal] = useState<FileRefusal | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'choose' });
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const pickedRef = useRef<HTMLParagraphElement>(null);
  const refusalRef = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  /** The file already on the verification: a retry then only submits. */
  const uploaded = useRef<Blob | null>(null);
  const listLabel = useId();
  const busy = phase.name === 'sending' || (phase.name === 'failed' && phase.retrying);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  // A picked file's summary takes focus, so it is read out; a server's refusal of the file does,
  // as the button the user pressed is gone (WCAG 2.4.3, 3.3.1).
  useEffect(() => {
    if (picked !== null) {
      pickedRef.current?.focus();
    }
  }, [picked]);
  useEffect(() => {
    if (refusal?.fromServer === true) {
      refusalRef.current?.focus();
    }
  }, [refusal]);

  const pick = async (file: File | undefined, method: CaptureMethod) => {
    if (file === undefined || busy) {
      return;
    }
    const check = await checkDocumentFile(file, mediaTypes);
    if (!check.ok) {
      setPicked(null);
      setRefusal({ error: check.error, fromServer: false });
      return;
    }
    setRefusal(null);
    setPhase({ name: 'choose' });
    // The bytes go typed by their content, never by the browser's guess from the file name.
    setPicked({
      blob: file.slice(0, file.size, check.mimeType),
      name: file.name,
      size: file.size,
      method,
    });
  };

  const send = async (document: PickedDocument, retryOf?: unknown) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPhase(
      retryOf === undefined
        ? { name: 'sending' }
        : { name: 'failed', error: retryOf, retrying: true },
    );
    let uploading = false;
    try {
      const id = await guided.verificationId(current.signal);
      if (uploaded.current !== document.blob) {
        uploading = true;
        await client.uploadFile(
          id,
          'document',
          document.blob,
          current.signal,
          undefined,
          document.method,
        );
        uploaded.current = document.blob;
        uploading = false;
      }
      await client.submitVerification(id, current.signal);
    } catch (error: unknown) {
      if (current.signal.aborted) {
        return;
      }
      if (uploading && isHttp(error, 413, 415, 422)) {
        // C52.4: the server refused the file itself; the user picks another.
        setPicked(null);
        setPhase({ name: 'choose' });
        setRefusal({
          error: isHttp(error, 413) ? 'too-large' : 'unsupported-type',
          fromServer: true,
        });
        return;
      }
      if (isConflict(error)) {
        // The verification or the inquiry moved on, perhaps in another window.
        await onSubmitted();
        return;
      }
      setPhase({ name: 'failed', error, retrying: false });
      return;
    }
    await onSubmitted();
  };

  const typeText = (type: DocumentType): string => {
    if (guidance === null) {
      return t(`document.typeNames.${type}`);
    }
    if (DATED_TYPES.has(type)) {
      return t(`document.types.${type as 'utility_bill'}`, { count: guidance['max-age-days'] });
    }
    return t(`document.types.${type as 'lease'}`);
  };

  // A step that takes photos only (and an image) has no file choice; otherwise files are offered.
  const uploads = methods.includes('upload') || cameraTypes.length === 0;
  const chooseFile = () => {
    if (!busy) {
      fileInput.current?.click();
    }
  };
  const takePhoto = () => {
    if (!busy) {
      cameraInput.current?.click();
    }
  };

  return (
    <Card title={t('document.title')} headingLevel={1}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p>{t('document.intro')}</p>
          <p className="text-sm font-medium text-ink-muted">
            {t('attempt', { current: attempt, max: maxAttempts })}
          </p>
        </div>
        <RetryHints hints={hints} photos={false} />
        <div className="flex flex-col gap-2">
          <p id={listLabel}>{t('document.accepted')}</p>
          <ul aria-labelledby={listLabel} className="list-disc space-y-1 ps-5">
            {types.map((type) => (
              <li key={type}>{typeText(type)}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-1 text-sm text-ink-muted">
          <p>{t('document.formats', { formats, size: sizeLimit })}</p>
          {mediaTypes.includes('application/pdf') && guidance !== null && (
            <p>{t('document.pages', { count: guidance['max-pages'] })}</p>
          )}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept={mediaTypes.join(',')}
          aria-label={t('document.chooseFileLabel')}
          // Opened by the buttons below; hidden so assistive tech meets one control.
          hidden
          onChange={(event) => {
            const input = event.currentTarget;
            const [file] = input.files ?? [];
            // Cleared, so choosing the same file again still fires a change.
            input.value = '';
            void pick(file, 'upload');
          }}
        />
        {cameraTypes.length > 0 && (
          <input
            ref={cameraInput}
            type="file"
            accept={cameraTypes.join(',')}
            capture="environment"
            aria-label={t('document.takePhotoLabel')}
            hidden
            onChange={(event) => {
              const input = event.currentTarget;
              const [file] = input.files ?? [];
              input.value = '';
              void pick(file, 'camera');
            }}
          />
        )}

        {refusal !== null && (
          <Alert ref={refusalRef} tabIndex={-1} tone="error">
            {t(`document.fileErrors.${refusal.error}`, { formats, size: sizeLimit })}
          </Alert>
        )}

        {picked === null ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            {uploads && (
              <Button
                variant={cameraTypes.length > 0 ? 'secondary' : 'primary'}
                aria-disabled={busy ? true : undefined}
                onClick={chooseFile}
              >
                {t('document.chooseFile')}
              </Button>
            )}
            {cameraTypes.length > 0 && (
              <Button aria-disabled={busy ? true : undefined} onClick={takePhoto}>
                {t('document.takePhoto')}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
            <p ref={pickedRef} tabIndex={-1} className="font-medium break-all focus:outline-none">
              {tb('document.picked', {
                name: picked.name,
                size: formatFileSize(picked.size, language),
              })}
            </p>
            <p className="text-sm text-ink-muted">{t('document.pickedHint')}</p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                aria-disabled={busy ? true : undefined}
                onClick={uploads ? chooseFile : takePhoto}
              >
                {t(uploads ? 'document.chooseAnother' : 'document.takeAnother')}
              </Button>
              {phase.name !== 'failed' && (
                <Button
                  className="aria-disabled:cursor-progress"
                  // Not `disabled`: a disabled button loses focus.
                  aria-disabled={busy ? true : undefined}
                  onClick={() => {
                    if (!busy) {
                      void send(picked);
                    }
                  }}
                >
                  {t('document.upload')}
                </Button>
              )}
            </div>
          </div>
        )}

        {busy && <p role="status">{t('document.uploading')}</p>}
        {phase.name === 'failed' && picked !== null && (
          <div className="flex flex-col gap-4">
            <Alert tone="error">{t(errorMessageKey(phase.error))}</Alert>
            <Button
              className="aria-disabled:cursor-progress sm:self-end"
              aria-disabled={phase.retrying ? true : undefined}
              onClick={() => {
                if (!phase.retrying) {
                  void send(picked, phase.error);
                }
              }}
            >
              {t('errors.retry')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
