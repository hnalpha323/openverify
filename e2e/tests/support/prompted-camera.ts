/**
 * Workflow 5C review K8: a camera that shows the pose the flow prompts for, held until the flow
 * prompts the next one. Chromium's file-backed fake camera plays a head-turn clip in real time,
 * so on a loaded machine the in-browser guidance judges a pose on a late frame and the shutter
 * takes a still of the clip's next pose, which the server refuses. Here the picture changes only
 * when the selfie step's live region announces another prompt (C46.1), so the guidance, the
 * auto-capture and the server always see the prompted pose, however slow the machine is.
 *
 * The pictures are person A's or B's C45.2 still triple (`head-turn-<person>-<pose>.jpg`), drawn
 * on a canvas whose stream `getUserMedia` answers for any video request. Nothing else of the page
 * is changed: the flow's guidance, auto-capture, uploads and the server's checks all run as built.
 */
import { readFile } from 'node:fs/promises';
import type { SelfiePose } from '@openverify/contracts';
import type { BrowserContext, Page } from '@playwright/test';
import { selfieStill } from '../../src/paths.js';
import { POSE_TITLES } from './flow.js';

const POSES = ['center', 'left', 'right'] as const satisfies readonly SelfiePose[];

interface CameraScript {
  /** Each pose's still, as a data URL. */
  readonly stills: Readonly<Record<SelfiePose, string>>;
  /** Each pose's prompt title, as the live region announces it. */
  readonly titles: Readonly<Record<SelfiePose, string>>;
}

/** Runs in the page before its own scripts: replaces the camera with the prompted stills. */
function installCamera({ stills, titles }: CameraScript): void {
  const media = navigator.mediaDevices as MediaDevices | undefined;
  if (media === undefined) {
    return;
  }
  const original = media.getUserMedia.bind(media);
  const images = new Map<string, HTMLImageElement>();
  const loaded = Promise.all(
    Object.entries(stills).map(
      ([pose, url]) =>
        new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            images.set(pose, image);
            resolve();
          };
          image.onerror = () => {
            reject(new Error(`The ${pose} still did not load`));
          };
          image.src = url;
        }),
    ),
  );
  /** The pose the selfie step announced last; the centre before its first prompt. */
  let current = 'center';
  const prompted = (): string => {
    const text = document.querySelector('[data-testid="selfie-announcement"]')?.textContent ?? '';
    current = Object.entries(titles).find(([, title]) => text.endsWith(title))?.[0] ?? current;
    return current;
  };
  media.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    if (constraints?.video === undefined || constraints.video === false) {
      return original(constraints);
    }
    await loaded;
    const first = images.get('center');
    const canvas = document.createElement('canvas');
    canvas.width = first?.naturalWidth ?? 640;
    canvas.height = first?.naturalHeight ?? 480;
    const context = canvas.getContext('2d');
    const draw = () => {
      const image = images.get(prompted());
      if (context !== null && image !== undefined) {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
    };
    draw();
    // Frames keep coming, as from a camera, so the track is never muted for want of them.
    const timer = window.setInterval(draw, 40);
    const stream = canvas.captureStream(25);
    for (const track of stream.getVideoTracks()) {
      const stop = track.stop.bind(track);
      track.stop = () => {
        window.clearInterval(timer);
        stop();
      };
    }
    return stream;
  };
}

/**
 * Replaces the camera of `target` (a page, or every page of a context) with person `person`'s
 * still of the prompted pose. Call it before the flow opens.
 */
export async function usePromptedCamera(
  target: Page | BrowserContext,
  person: 'a' | 'b' = 'a',
): Promise<void> {
  const entries = await Promise.all(
    POSES.map(
      async (pose) =>
        [
          pose,
          `data:image/jpeg;base64,${(await readFile(selfieStill(person, pose))).toString('base64')}`,
        ] as const,
    ),
  );
  const script: CameraScript = {
    stills: Object.fromEntries(entries) as Record<SelfiePose, string>,
    titles: POSE_TITLES,
  };
  await target.addInitScript(installCamera, script);
}
