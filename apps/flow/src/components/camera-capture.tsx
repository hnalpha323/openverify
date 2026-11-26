import { Alert, Button, cx } from '@openverify/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFlowEnvironment } from '../flow/flow-environment';
import { stopStream, type CameraErrorCode } from '../lib/camera-permission';
import { documentCameraConstraints, maximizeResolution } from '../lib/document-photo';
import type { PhotoCheck } from '../lib/photo-check';

export type CaptureGuideShape = 'document' | 'face';

export interface CameraCaptureProps {
  /** `environment` for documents (rear camera), `user` for selfies. */
  readonly facingMode: 'user' | 'environment';
  readonly guide: CaptureGuideShape;
  /** Mirror the preview (not the photo), as people expect from a front camera. */
  readonly mirrored: boolean;
  /** Phase 12A F4: an ID's back, framed for its barcode (a band in the guide and a hint). */
  readonly barcode?: boolean;
  /**
   * The photo, with the check of its guide region for a document (Phase 12A F3); `null` for a
   * face, which is not checked here.
   */
  readonly onCapture: (photo: Blob, check: PhotoCheck | null) => void;
  readonly onCancel: () => void;
}

type CameraState =
  | { readonly status: 'starting' }
  | { readonly status: 'live'; readonly stream: MediaStream }
  | { readonly status: 'failed'; readonly code: CameraErrorCode };

/**
 * Asks for a camera facing the right way, never the microphone: a face at up to 1080p, a document
 * at the camera's largest size (Phase 12A F1).
 */
function cameraConstraints(
  facingMode: 'user' | 'environment',
  guide: CaptureGuideShape,
): MediaStreamConstraints {
  if (guide === 'document') {
    return documentCameraConstraints(facingMode);
  }
  return {
    audio: false,
    video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  };
}

// The guide dims everything outside the frame with one oversized shadow (no inline styles,
// which the Content-Security-Policy would block).
const GUIDE_CLASSES: Record<CaptureGuideShape, string> = {
  document: 'aspect-[86/54] w-[85%] rounded-xl',
  face: 'aspect-[3/4] h-[78%] rounded-[50%]',
};

function CaptureGuide({
  shape,
  barcode,
}: {
  readonly shape: CaptureGuideShape;
  readonly barcode: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      data-guide={shape}
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <div
        className={cx(
          'relative border-4 border-white/90 shadow-[0_0_0_9999px_rgb(0_0_0/0.45)]',
          GUIDE_CLASSES[shape],
        )}
      >
        {/* Phase 12A F4: where a licence's PDF417 usually lies, across the lower half. */}
        {barcode && (
          <div
            aria-hidden="true"
            data-guide-band="barcode"
            className="absolute inset-x-[6%] top-[42%] bottom-[12%] rounded-sm border-2 border-dashed border-white/80"
          />
        )}
      </div>
    </div>
  );
}

/** A live camera preview with a framing guide and a shutter button. */
export function CameraCapture({
  facingMode,
  guide,
  mirrored,
  barcode = false,
  onCapture,
  onCancel,
}: CameraCaptureProps) {
  const { t } = useTranslation();
  const { requestCamera, captureFrame, captureDocument } = useFlowEnvironment();
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<CameraState>({ status: 'starting' });
  const [request, setRequest] = useState(0);
  const [hasFrame, setHasFrame] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    void requestCamera({ constraints: cameraConstraints(facingMode, guide) }).then((access) => {
      if (!access.ok) {
        if (active) {
          setCamera({ status: 'failed', code: access.error.code });
        }
        return;
      }
      if (!active) {
        // Granted after the user moved on: release the camera straight away.
        stopStream(access.stream);
        return;
      }
      stream = access.stream;
      setCamera({ status: 'live', stream: access.stream });
      if (guide === 'document') {
        // Phase 12A F1: then the largest size the camera says it can give.
        void maximizeResolution(access.stream);
      }
    });
    return () => {
      active = false;
      if (stream !== null) {
        stopStream(stream);
      }
    };
  }, [requestCamera, facingMode, guide, request]);

  useEffect(() => {
    const video = videoRef.current;
    if (camera.status !== 'live' || video === null) {
      return;
    }
    video.srcObject = camera.stream;
    // Autoplay can be refused; the shutter still works once a frame has loaded.
    video.play().catch(() => undefined);
  }, [camera]);

  const capture = async () => {
    const video = videoRef.current;
    if (video === null || camera.status !== 'live') {
      return;
    }
    setCapturing(true);
    setCaptureFailed(false);
    try {
      if (guide === 'document') {
        const view = viewRef.current;
        const size = { width: view?.clientWidth ?? 0, height: view?.clientHeight ?? 0 };
        const taken = await captureDocument(video, camera.stream, size);
        onCapture(taken.photo, taken.check);
      } else {
        onCapture(await captureFrame(video), null);
      }
    } catch {
      setCaptureFailed(true);
    } finally {
      setCapturing(false);
    }
  };

  if (camera.status === 'failed') {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="error">{t(`camera.errors.${camera.code}`)}</Alert>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel}>
            {t('capture.back')}
          </Button>
          <Button
            onClick={() => {
              setCamera({ status: 'starting' });
              setHasFrame(false);
              setRequest((value) => value + 1);
            }}
          >
            {t('capture.tryAgain')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={viewRef}
        className="relative aspect-[3/4] overflow-hidden rounded-xl bg-black sm:aspect-[4/3]"
      >
        <video
          ref={videoRef}
          aria-label={t('capture.preview')}
          data-mirrored={String(mirrored)}
          autoPlay
          muted
          playsInline
          onLoadedData={() => {
            setHasFrame(true);
          }}
          className={cx('size-full object-contain', mirrored && '-scale-x-100')}
        />
        <CaptureGuide shape={guide} barcode={barcode} />
      </div>
      {barcode && <p className="text-sm font-medium">{t('capture.barcodeHint')}</p>}
      {/* Stays mounted so screen readers hear each change: starting, then ready to capture. */}
      <p role="status" className={camera.status === 'starting' ? undefined : 'sr-only'}>
        {camera.status === 'starting'
          ? t('capture.startingCamera')
          : hasFrame
            ? t('capture.cameraReady')
            : ''}
      </p>
      {captureFailed && <Alert tone="error">{t('capture.captureFailed')}</Alert>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {t('capture.cancel')}
        </Button>
        <Button
          disabled={camera.status !== 'live' || !hasFrame || capturing}
          onClick={() => {
            void capture();
          }}
        >
          {t('capture.shutter')}
        </Button>
      </div>
    </div>
  );
}
