import { requiredFileKinds } from '@openverify/contracts';
import { Alert, Button, Card } from '@openverify/ui';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from '../api/error-message';
import { FlowApiError, type FlowApiClient } from '../api/flow-api-client';
import {
  CaptureSequence,
  type CaptureMethod,
  type CaptureShot,
  type CapturedPhotos,
} from '../components/capture-sequence';
import { RetryHints } from '../components/retry-hints';
import { useFlowEnvironment } from '../flow/flow-environment';
import type { FlowPosition, GovernmentIdStep } from '../flow/flow-position';
import { captureMethodsFor } from '../lib/capture-methods';
import { newSubmissionProgress, submitVerification } from '../flow/submit-verification';

export interface VerificationCaptureStepProps {
  /** A government ID step; selfies have their own step (`selfie-capture-step.tsx`, C46.1). */
  readonly position: Extract<FlowPosition, { kind: 'capture' }> & {
    readonly step: GovernmentIdStep;
  };
  readonly client: FlowApiClient;
  /** Reloads the session once the verification is submitted. */
  readonly onSubmitted: () => Promise<void>;
}

/** A 409: the server state changed under the client (C3), so a plain retry cannot help. */
const isConflict = (error: unknown): boolean =>
  error instanceof FlowApiError && error.kind === 'http' && error.status === 409;

type Phase =
  | { readonly name: 'capture' }
  | { readonly name: 'submitting' }
  /**
   * The last try failed. While Try again runs (`retrying`), this screen stays, so focus stays
   * on Try again (WCAG 2.4.3, the 3B follow-up; the F016 pattern).
   */
  | { readonly name: 'failed'; readonly error: unknown; readonly retrying: boolean };

/** The photos a government ID step needs, in order: each side. */
function shotsFor(
  step: GovernmentIdStep,
  t: TFunction,
  methods: readonly CaptureMethod[],
): CaptureShot[] {
  return requiredFileKinds(step).map((kind) => {
    const side = kind === 'back' ? 'back' : 'front';
    // Phase 12A F4: the back is framed for its barcode.
    const camera = {
      facingMode: 'environment',
      guide: 'document',
      mirrored: false,
      barcode: side === 'back',
    } as const;
    return {
      kind,
      title: t(`governmentId.${side}.title`),
      instruction: t(`governmentId.${side}.instruction`),
      previewAlt: t(`governmentId.${side}.alt`),
      uploadLabel: t(`governmentId.${side}.upload`),
      methods,
      camera,
    };
  });
}

/**
 * One attempt of a government ID step: capture every side, then create (or reuse) the
 * verification, upload each photo by kind and submit it.
 */
export function VerificationCaptureStep({
  position,
  client,
  onSubmitted,
}: VerificationCaptureStepProps) {
  const { t } = useTranslation();
  // C153.2: the step's methods for this device class.
  const { deviceKind } = useFlowEnvironment();
  const { step, attempt, maxAttempts, hints, verificationId } = position;
  const [phase, setPhase] = useState<Phase>({ name: 'capture' });
  const [photos, setPhotos] = useState<CapturedPhotos>([]);
  const [sequence, setSequence] = useState(0);
  const progress = useRef(newSubmissionProgress(verificationId));
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const submit = async (files: CapturedPhotos, retryOf?: unknown) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPhase(
      retryOf === undefined
        ? { name: 'submitting' }
        : { name: 'failed', error: retryOf, retrying: true },
    );
    try {
      await submitVerification({
        client,
        type: 'government-id',
        files,
        progress: progress.current,
        signal: current.signal,
      });
    } catch (error: unknown) {
      // Read on each call: the step may unmount while a session reload is awaited.
      const active = () => !current.signal.aborted;
      if (active() && isConflict(error)) {
        // The verification or the inquiry moved on: typically an earlier submit reached the
        // server but its answer was lost. Retrying cannot succeed; the session knows where the
        // user is now (processing, the next step, or a new attempt).
        await onSubmitted();
      }
      if (active()) {
        setPhase({ name: 'failed', error, retrying: false });
      }
      return;
    }
    await onSubmitted();
  };

  return (
    <Card title={t('governmentId.title')} headingLevel={1}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p>{t('governmentId.intro')}</p>
          <p className="text-sm font-medium text-ink-muted">
            {t('attempt', { current: attempt, max: maxAttempts })}
          </p>
        </div>
        {phase.name === 'capture' && <RetryHints hints={hints} />}

        {phase.name === 'capture' && (
          <CaptureSequence
            key={sequence}
            shots={shotsFor(step, t, captureMethodsFor(step, deviceKind))}
            onComplete={(captured) => {
              setPhotos(captured);
              void submit(captured);
            }}
          />
        )}

        {phase.name === 'submitting' && <p role="status">{t('submission.uploading')}</p>}

        {phase.name === 'failed' && (
          <div className="flex flex-col gap-4">
            <Alert tone="error">{t(errorMessageKey(phase.error))}</Alert>
            {phase.retrying && <p role="status">{t('submission.uploading')}</p>}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                // Not `disabled`: a disabled button loses focus.
                aria-disabled={phase.retrying ? true : undefined}
                onClick={() => {
                  if (phase.retrying) {
                    return;
                  }
                  // New photos replace the old ones of the same kinds on this verification.
                  progress.current.uploaded.clear();
                  setSequence((value) => value + 1);
                  setPhase({ name: 'capture' });
                }}
              >
                {t('submission.retake')}
              </Button>
              <Button
                className="aria-disabled:cursor-progress"
                aria-disabled={phase.retrying ? true : undefined}
                onClick={() => {
                  if (!phase.retrying) {
                    void submit(photos, phase.error);
                  }
                }}
              >
                {t('submission.retry')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
