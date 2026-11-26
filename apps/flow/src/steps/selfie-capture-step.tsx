/**
 * The selfie step (C46.1): the C40 capture protocol with the in-browser guidance.
 *
 * - **Camera.** The front camera opens once and stays open for the whole capture. Once it shows a
 *   frame, the verification is created (or reused) and the capture is created, before the first
 *   prompt. Prompts follow the server's order and are announced. Each pose is taken automatically
 *   once the guidance sees it held (or with the manual shutter, after 10 s or at once without a
 *   detector), uploaded at once, and the next prompt shows only after that upload. A failed
 *   upload is retried for the same pose. Submit names the capture with the device snapshot.
 * - **Upload** (sandbox only, C19): a capture with `method: upload`; each prompted pose is chosen
 *   as a file and uploaded in the server's order.
 * - A 409 `selfie_capture_invalid` (an expired, superseded or refused capture) starts again with a
 *   new capture, the camera still open. A reload loses the nonce, so the user starts again too.
 *
 * Focus never falls to the page (WCAG 2.4.3): the two buttons stay mounted and say when they are
 * busy (`aria-disabled`), so the shutter or Try again keeps focus while a photo uploads.
 */
import { SELFIE_CAPTURE_CLIENT, type SelfiePose } from '@openverify/contracts';
import { Alert, Button, Card, cx } from '@openverify/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from '../api/error-message';
import type { FlowApiClient } from '../api/flow-api-client';
import { RetryHints } from '../components/retry-hints';
import { useFlowEnvironment } from '../flow/flow-environment';
import type { FlowPosition, SelfieStep } from '../flow/flow-position';
import { newSubmissionProgress } from '../flow/submit-verification';
import { guidanceThresholds, type GuidanceState } from '../guidance/guidance-machine';
import { IMAGE_INPUT_ACCEPT, checkImageFile, type ImageFileError } from '../lib/image-file';
import type { HeldFrame } from '../lib/sample-frame';
import {
  captureFailure,
  openSelfieCapture,
  submitSelfieCapture,
  uploadSelfiePose,
  type OpenCapture,
} from '../selfie/capture-protocol';
import { CaptureTimeWarning } from '../selfie/capture-time-warning';
import { deviceSnapshot, type CameraTrackLike } from '../selfie/device-snapshot';
import { useCameraStream } from '../selfie/use-camera-stream';
import { useGuidance, type DetectorSlot, type GuidancePrompt } from '../selfie/use-guidance';

export type SelfieCapturePosition = Extract<FlowPosition, { kind: 'capture' }> & {
  readonly step: SelfieStep;
};

export interface SelfieCaptureStepProps {
  readonly position: SelfieCapturePosition;
  readonly client: FlowApiClient;
  /** Reloads the session once the verification is submitted, or has moved on. */
  readonly onSubmitted: () => Promise<void>;
  /** A sandbox session (C19) may upload the poses instead of taking them with the camera. */
  readonly sandbox?: boolean;
}

type Method = 'camera' | 'upload';

/** One open capture and where the user is in its prompts. */
interface Run {
  readonly verificationId: string;
  readonly capture: OpenCapture;
  readonly index: number;
  /** The yaw ratio of the centre photo the guidance measured, for the side poses. */
  readonly centreYaw: number | null;
  /** This capture replaced one the server refused: say so until the next photo. */
  readonly restarted: boolean;
  /** Counts photos taken for this prompt, so a retake starts its own guidance. */
  readonly shot: number;
}

type Activity =
  /** Waiting for the camera's first frame. */
  | { readonly kind: 'camera' }
  | { readonly kind: 'opening'; readonly restarted: boolean; readonly retrying: boolean }
  | {
      readonly kind: 'open-failed';
      readonly error: unknown;
      readonly restarted: boolean;
    }
  | {
      readonly kind: 'prompting';
      readonly run: Run;
      /** Upload mode: the file chosen for this pose, shown before it is used. */
      readonly chosen: Blob | null;
      readonly fileError: ImageFileError | null;
      /** Camera mode: the frame could not be taken. */
      readonly frameFailed: boolean;
    }
  | {
      readonly kind: 'uploading';
      readonly run: Run;
      readonly photo: Blob;
      readonly yaw: number | null;
      readonly retrying: boolean;
    }
  | {
      readonly kind: 'upload-failed';
      readonly run: Run;
      readonly photo: Blob;
      readonly yaw: number | null;
      readonly error: unknown;
    }
  | { readonly kind: 'submitting'; readonly run: Run; readonly retrying: boolean }
  | { readonly kind: 'submit-failed'; readonly run: Run; readonly error: unknown };

/** Where focus goes after a change that removes the focused control, or `null` to leave it. */
type FocusTarget = 'prompt' | 'start' | 'upload' | null;

const poseOf = (run: Run): SelfiePose => run.capture.prompts[run.index] ?? 'center';

/** The guided selfie: the camera with the guidance, or (in sandbox) uploaded files. */
export function SelfieCaptureStep({
  position,
  client,
  onSubmitted,
  sandbox = false,
}: SelfieCaptureStepProps) {
  const { t } = useTranslation();
  const environment = useFlowEnvironment();
  const { step, attempt, maxAttempts, hints, verificationId } = position;
  const [method, setMethod] = useState<Method | null>(null);
  const [activity, setActivity] = useState<Activity>({ kind: 'camera' });
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [detector, setDetector] = useState<DetectorSlot>('loading');
  const progress = useRef(newSubmissionProgress(verificationId));
  const controller = useRef<AbortController | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const focusAfter = useRef<FocusTarget>(null);
  const opened = useRef(false);
  const camera = useCameraStream(method === 'camera', cameraAttempt);

  // The detector loads while the user reads the step, so the guidance is ready in time.
  useEffect(() => {
    let active = true;
    void environment.loadFaceDetector().then((loaded) => {
      if (active) {
        setDetector(loaded);
      }
    });
    return () => {
      active = false;
    };
  }, [environment]);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  // Show the live camera in the preview; the shutter works once a frame has loaded.
  useEffect(() => {
    const element = video.current;
    if (camera.status !== 'live' || element === null) {
      return;
    }
    element.srcObject = camera.stream;
    element.play().catch(() => undefined);
  }, [camera]);

  useLayoutEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === 'prompt') {
      heading.current?.focus();
    } else if (target === 'start') {
      startButton.current?.focus();
    } else if (target === 'upload') {
      uploadButton.current?.focus();
    }
  });

  /** A fresh signal for the next request; the previous one is aborted. */
  const renew = (): AbortSignal => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    return next.signal;
  };

  /**
   * After a refusal that the session explains (the verification moved on, or its capture limit
   * canceled it): reload it. If the step is still shown afterwards, `fallback` shows the error.
   */
  const handOver = async (signal: AbortSignal, fallback: () => void) => {
    await onSubmitted();
    if (!signal.aborted) {
      fallback();
    }
  };

  const open = async (using: Method, restarted: boolean, retrying = false) => {
    const signal = renew();
    setActivity({ kind: 'opening', restarted, retrying });
    try {
      const { verificationId: id, capture } = await openSelfieCapture({
        client,
        progress: progress.current,
        method: using,
        now: environment.now,
        signal,
      });
      if (signal.aborted) {
        return;
      }
      if (using === 'upload') {
        focusAfter.current = 'prompt';
      }
      setActivity({
        kind: 'prompting',
        run: { verificationId: id, capture, index: 0, centreYaw: null, restarted, shot: 0 },
        chosen: null,
        fileError: null,
        frameFailed: false,
      });
    } catch (error: unknown) {
      if (signal.aborted) {
        return;
      }
      const failed = () => {
        setActivity({ kind: 'open-failed', error, restarted });
      };
      const failure = captureFailure(error);
      if (failure === 'capture-limit' || failure === 'conflict') {
        await handOver(signal, failed);
      } else {
        failed();
      }
    }
  };

  const submit = async (run: Run, using: Method, retrying = false) => {
    const signal = renew();
    setActivity({ kind: 'submitting', run, retrying });
    const track = cameraTrack(camera);
    let device;
    try {
      device = using === 'camera' && track !== null ? deviceSnapshot(track, navigator) : undefined;
    } catch {
      // A snapshot the contract refuses is left out: it is a risk signal, not a requirement.
      device = undefined;
    }
    try {
      await submitSelfieCapture({
        client,
        verificationId: run.verificationId,
        capture: run.capture,
        ...(device === undefined ? {} : { device }),
        signal,
      });
    } catch (error: unknown) {
      if (signal.aborted) {
        return;
      }
      const failed = () => {
        setActivity({ kind: 'submit-failed', run, error });
      };
      const failure = captureFailure(error);
      if (failure === 'capture-invalid') {
        void open(using, true);
      } else if (failure === 'capture-limit' || failure === 'conflict') {
        await handOver(signal, failed);
      } else {
        failed();
      }
      return;
    }
    if (!signal.aborted) {
      await onSubmitted();
    }
  };

  const upload = async (
    run: Run,
    using: Method,
    photo: Blob,
    yaw: number | null,
    retrying = false,
  ) => {
    const signal = renew();
    setActivity({ kind: 'uploading', run, photo, yaw, retrying });
    const pose = poseOf(run);
    try {
      await uploadSelfiePose({
        client,
        verificationId: run.verificationId,
        capture: run.capture,
        pose,
        photo,
        now: environment.now,
        signal,
        // C153.2: the live camera, or (in sandbox) an uploaded file.
        ...(method === null ? {} : { captureMethod: method }),
      });
    } catch (error: unknown) {
      if (signal.aborted) {
        return;
      }
      const failed = () => {
        setActivity({ kind: 'upload-failed', run, photo, yaw, error });
      };
      const failure = captureFailure(error);
      if (failure === 'capture-invalid') {
        void open(using, true);
      } else if (failure === 'capture-limit' || failure === 'conflict') {
        await handOver(signal, failed);
      } else {
        failed();
      }
      return;
    }
    if (signal.aborted) {
      return;
    }
    const next: Run = {
      ...run,
      index: run.index + 1,
      centreYaw: pose === 'center' ? yaw : run.centreYaw,
      restarted: false,
      shot: 0,
    };
    if (next.index < run.capture.prompts.length) {
      if (using === 'upload') {
        focusAfter.current = 'prompt';
      }
      setActivity({
        kind: 'prompting',
        run: next,
        chosen: null,
        fileError: null,
        frameFailed: false,
      });
    } else {
      await submit(next, using);
    }
  };

  /**
   * Takes the photo for the prompt: on an auto-capture, the copy of the frame the guidance judged
   * (KP10-3), taken before anything awaits so no later sample replaces it; for the user's shutter,
   * or from a sampler that holds no copy, the camera's current frame. A judged frame that is gone
   * is never replaced by a later one: the user is asked to try again.
   */
  const takePhoto = async (run: Run, yaw: number | null, judged: HeldFrame | null = null) => {
    const element = video.current;
    if (element === null || camera.status !== 'live') {
      return;
    }
    let photo: Blob | null;
    try {
      photo = await (judged === null ? environment.captureFrame(element) : judged.take());
    } catch {
      photo = null;
    }
    if (photo === null) {
      setActivity({
        kind: 'prompting',
        run: { ...run, shot: run.shot + 1 },
        chosen: null,
        fileError: null,
        frameFailed: true,
      });
      return;
    }
    await upload(run, 'camera', photo, yaw);
  };

  const prompting = activity.kind === 'prompting' ? activity : null;
  // The guidance runs only on a live camera: a stopped one shows its last frame (H013).
  const guidancePrompt: GuidancePrompt | null =
    method === 'camera' && prompting !== null && camera.status === 'live'
      ? {
          key: `${prompting.run.capture.id}:${String(prompting.run.index)}:${String(prompting.run.shot)}`,
          pose: poseOf(prompting.run),
          centreYawRatio: prompting.run.centreYaw,
        }
      : null;
  // One object per capture: the guidance restarts only when the thresholds really change.
  const captureGuidance = prompting?.run.capture.guidance ?? null;
  const thresholds = useMemo(
    () =>
      captureGuidance === null ? null : guidanceThresholds(captureGuidance, SELFIE_CAPTURE_CLIENT),
    [captureGuidance],
  );
  const guidance = useGuidance({
    prompt: guidancePrompt,
    thresholds,
    detector,
    video,
    onAutoCapture: (state: GuidanceState, held: HeldFrame | null) => {
      if (prompting !== null) {
        void takePhoto(prompting.run, state.yawRatio, held);
      }
    },
    onDetectorFailed: () => {
      setDetector(null);
    },
  });

  const begin = (using: Method) => {
    opened.current = false;
    focusAfter.current = 'prompt';
    setMethod(using);
    if (using === 'upload') {
      void open('upload', false);
    } else {
      setActivity({ kind: 'camera' });
    }
  };

  const cancel = () => {
    controller.current?.abort();
    focusAfter.current = method === 'upload' ? 'upload' : 'start';
    setMethod(null);
    setActivity({ kind: 'camera' });
  };

  const chooseFile = async (file: File | undefined) => {
    if (file === undefined || prompting === null) {
      return;
    }
    const check = await checkImageFile(file);
    setActivity({
      ...prompting,
      chosen: check.ok ? file : null,
      fileError: check.ok ? null : check.error,
    });
  };

  const isCentreOnly = step.poses.every((pose) => pose === 'center');

  if (method === null) {
    return (
      <Card title={t('selfie.title')} headingLevel={1}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p>{t('selfie.intro')}</p>
            <p>{t(isCentreOnly ? 'selfie.howItWorksCenter' : 'selfie.howItWorks')}</p>
            <p className="text-sm font-medium text-ink-muted">
              {t('attempt', { current: attempt, max: maxAttempts })}
            </p>
          </div>
          <RetryHints hints={hints} />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {sandbox && (
              <Button
                ref={uploadButton}
                variant="secondary"
                onClick={() => {
                  begin('upload');
                }}
              >
                {t('selfie.uploadInstead')}
              </Button>
            )}
            <Button
              ref={startButton}
              onClick={() => {
                begin('camera');
              }}
            >
              {t('selfie.start')}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const run = 'run' in activity ? activity.run : null;
  const total = run?.capture.prompts.length ?? 0;
  const current = run === null ? 0 : run.index + 1;
  const pose = run === null ? null : poseOf(run);
  const promptTitle = pose === null ? t('selfie.preparing') : t(`selfie.${pose}.title`);

  let announcement = '';
  if (method === 'camera' && camera.status === 'starting') {
    announcement = t('capture.startingCamera');
  } else if (activity.kind === 'opening') {
    announcement = activity.restarted ? t('selfie.restarted') : t('selfie.opening');
  } else if (activity.kind === 'prompting' && pose !== null) {
    const prompt = t('selfie.prompt', { current, total, title: promptTitle });
    announcement = activity.run.restarted ? `${t('selfie.restarted')} ${prompt}` : prompt;
  } else if (activity.kind === 'uploading') {
    announcement = t('selfie.uploadingPose', { current, total });
  } else if (activity.kind === 'submitting') {
    announcement = t('selfie.submitting');
  }

  let error: unknown = null;
  if (
    activity.kind === 'open-failed' ||
    activity.kind === 'upload-failed' ||
    activity.kind === 'submit-failed'
  ) {
    ({ error } = activity);
  }

  // The two buttons, the same elements in every state, so focus never falls to the page.
  let primary: { label: string; busy: boolean; onClick: () => void };
  let secondary: { label: string; busy: boolean; onClick: () => void } = {
    label: t('capture.cancel'),
    busy: false,
    onClick: cancel,
  };
  switch (activity.kind) {
    case 'open-failed':
      primary = {
        label: t('errors.retry'),
        busy: false,
        onClick: () => void open(method, activity.restarted, true),
      };
      break;
    case 'opening':
      primary = activity.retrying
        ? { label: t('errors.retry'), busy: true, onClick: () => undefined }
        : { label: t('capture.shutter'), busy: true, onClick: () => undefined };
      break;
    case 'uploading':
      primary = {
        label: activity.retrying
          ? t('errors.retry')
          : t(method === 'camera' ? 'capture.shutter' : 'capture.usePhoto'),
        busy: true,
        onClick: () => undefined,
      };
      break;
    case 'upload-failed':
      primary = {
        label: t('errors.retry'),
        busy: false,
        onClick: () => void upload(activity.run, method, activity.photo, activity.yaw, true),
      };
      secondary = {
        label: t('selfie.retakePose'),
        busy: false,
        onClick: () => {
          setActivity({
            kind: 'prompting',
            run: { ...activity.run, shot: activity.run.shot + 1 },
            chosen: null,
            fileError: null,
            frameFailed: false,
          });
        },
      };
      break;
    case 'submitting':
      primary = {
        label: activity.retrying ? t('errors.retry') : t('capture.shutter'),
        busy: true,
        onClick: () => undefined,
      };
      break;
    case 'submit-failed':
      primary = {
        label: t('errors.retry'),
        busy: false,
        onClick: () => void submit(activity.run, method, true),
      };
      break;
    case 'prompting':
      if (method === 'camera') {
        primary = {
          label: t('capture.shutter'),
          busy: guidance?.manualShutter !== true,
          onClick: () => void takePhoto(activity.run, guidance?.yawRatio ?? null),
        };
      } else if (activity.chosen === null) {
        primary = {
          label: t('capture.uploadPhoto'),
          busy: false,
          onClick: () => fileInput.current?.click(),
        };
      } else {
        const photo = activity.chosen;
        primary = {
          label: t('capture.usePhoto'),
          busy: false,
          onClick: () => void upload(activity.run, method, photo, null),
        };
        secondary = {
          label: t('capture.retake'),
          busy: false,
          onClick: () => {
            setActivity({ ...activity, chosen: null });
          },
        };
      }
      break;
    case 'camera':
      primary = { label: t('capture.shutter'), busy: true, onClick: () => undefined };
      break;
  }

  const chosen =
    activity.kind === 'prompting'
      ? activity.chosen
      : activity.kind === 'uploading' || activity.kind === 'upload-failed'
        ? activity.photo
        : null;

  return (
    <Card title={t('selfie.title')} headingLevel={1}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          {total > 1 && (
            <p className="text-sm font-medium text-ink-muted">
              {t('capture.progress', { current, total })}
            </p>
          )}
          <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
            {promptTitle}
          </h2>
          {pose !== null && <p>{t(`selfie.${pose}.instruction`)}</p>}
        </div>

        {run?.restarted === true && <Alert tone="info">{t('selfie.restarted')}</Alert>}

        {/* C171.4 (WCAG 2.2.1): 20 s before the capture's limit, a warning and more time. */}
        {run !== null && activity.kind !== 'submitting' && (
          <CaptureTimeWarning key={run.capture.id} capture={run.capture} client={client} />
        )}

        {method === 'camera' && camera.status === 'failed' ? (
          <Alert tone="error">{t(`camera.errors.${camera.code}`)}</Alert>
        ) : null}

        {method === 'camera' && camera.status !== 'failed' && (
          <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-black sm:aspect-[4/3]">
            <video
              ref={video}
              aria-label={t('capture.preview')}
              data-mirrored="true"
              autoPlay
              muted
              playsInline
              onLoadedData={() => {
                if (!opened.current) {
                  opened.current = true;
                  void open('camera', false);
                }
              }}
              className="size-full -scale-x-100 object-contain"
            />
            <div
              aria-hidden="true"
              data-guide="face"
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <div className="aspect-[3/4] h-[78%] rounded-[50%] border-4 border-white/90 shadow-[0_0_0_9999px_rgb(0_0_0/0.45)]" />
            </div>
            {guidance !== null && (
              <p
                data-testid="guidance-message"
                className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-center text-sm font-medium text-white"
              >
                {t(`selfie.guidance.${guidance.message}`)}
              </p>
            )}
          </div>
        )}

        {method === 'upload' && pose !== null && (
          <>
            <input
              ref={fileInput}
              key={`${run?.capture.id ?? ''}:${String(current)}`}
              type="file"
              accept={IMAGE_INPUT_ACCEPT}
              aria-label={t(`selfie.${pose}.upload`)}
              hidden
              onChange={(event) => {
                const input = event.currentTarget;
                const [file] = input.files ?? [];
                input.value = '';
                void chooseFile(file);
              }}
            />
            {chosen !== null && <SelfiePreview photo={chosen} alt={t(`selfie.${pose}.alt`)} />}
            {prompting?.fileError != null && (
              <Alert tone="error">{t(`capture.fileErrors.${prompting.fileError}`)}</Alert>
            )}
          </>
        )}

        {/* Each prompt, upload and restart is announced here. */}
        <p role="status" data-testid="selfie-announcement" className="sr-only">
          {announcement}
        </p>
        {/* Guidance messages, once they have stayed on screen (8 Hz would be noise). */}
        <p aria-live="polite" data-testid="guidance-announcement" className="sr-only">
          {guidance?.announcement == null ? '' : t(`selfie.guidance.${guidance.announcement}`)}
        </p>

        {method === 'camera' && prompting !== null && guidance !== null && (
          <p className="text-sm text-ink-muted">
            {t(guidance.manualShutter ? 'selfie.shutterReady' : 'selfie.shutterSoon')}
          </p>
        )}
        {prompting?.frameFailed === true && (
          <Alert tone="error">{t('capture.captureFailed')}</Alert>
        )}
        {error !== null && <Alert tone="error">{t(errorMessageKey(error))}</Alert>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {method === 'camera' && camera.status === 'failed' ? (
            <>
              <Button variant="secondary" onClick={cancel}>
                {t('capture.back')}
              </Button>
              <Button
                onClick={() => {
                  setCameraAttempt((value) => value + 1);
                }}
              >
                {t('capture.tryAgain')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                aria-disabled={secondary.busy ? true : undefined}
                onClick={() => {
                  if (!secondary.busy) {
                    secondary.onClick();
                  }
                }}
              >
                {secondary.label}
              </Button>
              <Button
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                // Not `disabled`: a disabled button loses focus.
                aria-disabled={primary.busy ? true : undefined}
                onClick={() => {
                  if (!primary.busy) {
                    primary.onClick();
                  }
                }}
              >
                {primary.label}
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

/** The photo chosen for an upload prompt, shown before it is used. */
function SelfiePreview({ photo, alt }: { readonly photo: Blob; readonly alt: string }) {
  const image = useRef<HTMLImageElement>(null);
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
    <div className="overflow-hidden rounded-xl border border-line bg-canvas">
      <img ref={image} alt={alt} className={cx('mx-auto max-h-96 w-full object-contain')} />
    </div>
  );
}

/** The camera's video track, for the device snapshot, or `null`. */
function cameraTrack(camera: ReturnType<typeof useCameraStream>): CameraTrackLike | null {
  if (camera.status !== 'live') {
    return null;
  }
  const [track] = camera.stream.getVideoTracks();
  return track ?? null;
}
