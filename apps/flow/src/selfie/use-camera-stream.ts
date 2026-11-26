/**
 * The selfie camera (C46.1): the front camera, opened once and kept open for the whole capture,
 * across every prompt, upload and restart, and released when the capture ends or the step goes
 * away. Never the microphone.
 */
import { useEffect, useState } from 'react';
import { useFlowEnvironment } from '../flow/flow-environment';
import { stopStream, type CameraErrorCode } from '../lib/camera-permission';

export type CameraStream =
  | { readonly status: 'off' }
  | { readonly status: 'starting' }
  | { readonly status: 'live'; readonly stream: MediaStream }
  | { readonly status: 'failed'; readonly code: CameraErrorCode };

/** The front camera at up to 1080p, as the selfie step asks for it. */
export const SELFIE_CAMERA_CONSTRAINTS: MediaStreamConstraints = Object.freeze({
  audio: false,
  video: { facingMode: { ideal: 'user' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
});

/**
 * The camera while `enabled`; each new `attempt` asks again (after a failure). Turning it off,
 * or unmounting, stops every track.
 *
 * A video track that ends (another app took the camera, the device went away) or is muted (the
 * page went to the background, a privacy switch) delivers no new frame, while the preview keeps
 * its last one. The camera then reads `failed` with `camera-in-use` and is released, so nothing
 * photographs the frozen frame, and the user gets "Try again" (Workflow 4B review H013).
 */
export function useCameraStream(enabled: boolean, attempt: number): CameraStream {
  const { requestCamera } = useFlowEnvironment();
  const [camera, setCamera] = useState<CameraStream>({ status: 'off' });

  useEffect(() => {
    if (!enabled) {
      setCamera({ status: 'off' });
      return;
    }
    let active = true;
    let stream: MediaStream | null = null;
    let tracks: MediaStreamTrack[] = [];
    const stopped = () => {
      if (active && stream !== null) {
        stopStream(stream);
        setCamera({ status: 'failed', code: 'camera-in-use' });
      }
    };
    setCamera({ status: 'starting' });
    void requestCamera({ constraints: SELFIE_CAMERA_CONSTRAINTS }).then((access) => {
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
      tracks = access.stream.getVideoTracks();
      for (const track of tracks) {
        track.addEventListener('ended', stopped);
        track.addEventListener('mute', stopped);
      }
      if (tracks.some((track) => track.readyState === 'ended')) {
        stopped();
        return;
      }
      setCamera({ status: 'live', stream: access.stream });
    });
    return () => {
      active = false;
      for (const track of tracks) {
        track.removeEventListener('ended', stopped);
        track.removeEventListener('mute', stopped);
      }
      if (stream !== null) {
        stopStream(stream);
      }
    };
  }, [requestCamera, enabled, attempt]);

  return camera;
}
