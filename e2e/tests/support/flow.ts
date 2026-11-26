/**
 * What an end user does in the hosted flow (apps/flow), driven through its accessible names.
 * The ID is uploaded as files; the selfie comes from Chromium's fake camera, which plays the
 * clip given to `--use-file-for-fake-video-capture` (a C45.2 head-turn MJPEG clip, one browser
 * launch per clip because the switch is process-wide).
 */
import type { SelfiePose } from '@openverify/contracts';
import { expect, type Page } from '@playwright/test';

/** Chromium switches that replace the camera with a clip and accept the permission prompt. */
export function fakeCameraArgs(clip: string): string[] {
  return [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${clip}`,
  ];
}

/** Console errors and page errors, including Content-Security-Policy violations. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** The checkbox of the optional matching consent (C42.3), named by its own text. */
export const MATCHING_CONSENT = /^Optional: we also compare your selfie and its background/;

/**
 * Accepts the required consent texts and, with `matching: true`, ticks the optional matching
 * consent (C42.3), which starts unticked.
 */
export async function giveConsent(page: Page, options: { matching?: boolean } = {}): Promise<void> {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Consent to use your biometric data' }),
  ).toBeVisible();
  if (options.matching === true) {
    const matching = page.getByRole('checkbox', { name: MATCHING_CONSENT });
    // Declining is the default: the box starts unticked.
    await expect(matching).not.toBeChecked();
    await matching.check();
  }
  await page.getByRole('checkbox', { name: /^I agree/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

export async function uploadId(page: Page, front: string, back: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Photograph your ID' })).toBeVisible();
  await page.getByLabel('Choose a photo of the front of your ID').setInputFiles(front);
  await expect(page.getByRole('img', { name: 'Your photo of the front of your ID' })).toBeVisible();
  await page.getByRole('button', { name: 'Use this photo' }).click();
  await page.getByLabel('Choose a photo of the back of your ID').setInputFiles(back);
  await expect(page.getByRole('img', { name: 'Your photo of the back of your ID' })).toBeVisible();
  await page.getByRole('button', { name: 'Use this photo' }).click();
}

/** Each prompt's title, as the selfie step shows and announces it (C46.1). */
export const POSE_TITLES: Readonly<Record<SelfiePose, string>> = Object.freeze({
  center: 'Look straight ahead',
  left: 'Turn your head to the left',
  right: 'Turn your head to the right',
});

/** One photo of the guided selfie: the prompted pose, and who pressed the shutter. */
export interface SelfieShot {
  readonly pose: SelfiePose;
  /** `auto`: the in-browser guidance saw the pose held; `manual`: the offered shutter was used. */
  readonly shutter: 'auto' | 'manual';
}

const PROMPT = /Photo (\d+) of (\d+): (.+)$/;

/** The selfie step's live region, which announces each prompt (C46.1). */
export function selfieAnnouncement(page: Page) {
  return page.getByTestId('selfie-announcement');
}

/** The prompt the selfie step announces now: its number, the number of prompts, its pose. */
export async function currentPrompt(
  page: Page,
): Promise<{ index: number; total: number; pose: SelfiePose }> {
  // The region says "Uploading photo N of 3…" between two prompts, so a read here waits past it.
  const region = selfieAnnouncement(page);
  await expect(region).toHaveText(PROMPT, { timeout: 60_000 });
  const text = (await region.textContent()) ?? '';
  const match = PROMPT.exec(text);
  const entry = Object.entries(POSE_TITLES).find(([, title]) => title === match?.[3]);
  if (match === null || entry === undefined) {
    throw new Error(`The selfie step announces no prompt: ${text}`);
  }
  return { index: Number(match[1]), total: Number(match[2]), pose: entry[0] as SelfiePose };
}

/**
 * Waits for the ID to be checked (the worker runs vision on it), then takes the selfie with the
 * C40 protocol, as a user does: the camera opens once and stays open, and each prompt is
 * followed in the server's order. With `shutter: 'auto'` the shutter is never pressed, so every
 * photo must be taken by the guidance's auto-capture (C40.11); with `'manual-when-offered'` the
 * shutter is pressed once the flow offers it (after 10 s), for a clip that never holds a pose.
 * Returns the prompts in order and how each photo was taken.
 */
export async function takeSelfie(
  page: Page,
  options: { shutter?: 'auto' | 'manual-when-offered'; promptTimeoutMs?: number } = {},
): Promise<SelfieShot[]> {
  const mode = options.shutter ?? 'auto';
  const promptTimeoutMs = options.promptTimeoutMs ?? 45_000;
  await expect(page.getByRole('heading', { level: 1, name: 'Take a selfie' })).toBeVisible({
    timeout: 90_000,
  });
  await page.getByRole('button', { name: 'Start the camera' }).click();
  const status = selfieAnnouncement(page);
  const shutter = page.getByRole('button', { name: 'Capture' });
  await expect(status).toHaveText(/Photo 1 of \d+: /, { timeout: 60_000 });
  const { total } = await currentPrompt(page);

  const shots: SelfieShot[] = [];
  for (let index = 1; index <= total; index += 1) {
    const current = new RegExp(`Photo ${String(index)} of ${String(total)}: `);
    await expect(status).toHaveText(current, { timeout: promptTimeoutMs });
    const { pose } = await currentPrompt(page);
    let shutterUsed: SelfieShot['shutter'] = 'auto';
    await expect
      .poll(
        async () => {
          // Read without waiting: after the last photo the step (and its live region) is gone.
          const [announced = ''] = await status.allTextContents();
          if (!current.test(announced)) {
            return 'taken';
          }
          const offered = await shutter.evaluateAll((buttons) =>
            buttons.some((button) => button.getAttribute('aria-disabled') !== 'true'),
          );
          if (mode === 'manual-when-offered' && offered) {
            shutterUsed = 'manual';
            await shutter.click();
            return 'taken';
          }
          return 'waiting';
        },
        { timeout: promptTimeoutMs, intervals: [250] },
      )
      .toBe('taken');
    shots.push({ pose, shutter: shutterUsed });
  }
  return shots;
}
