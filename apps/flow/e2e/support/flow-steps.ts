/** What an end user does in the flow, through its accessible names (C19 specs). */
import { expect, type Page } from '@playwright/test';
import { syntheticCardPng } from './synthetic-png';

const FRONT = { name: 'front.png', mimeType: 'image/png', buffer: syntheticCardPng() };
const BACK = {
  name: 'back.png',
  mimeType: 'image/png',
  buffer: syntheticCardPng({ background: [236, 230, 214] }),
};
/** Not a face: the mocked API never analyses it. */
const SELFIE = {
  name: 'selfie.png',
  mimeType: 'image/png',
  buffer: syntheticCardPng({ width: 240, height: 320, background: [210, 214, 220] }),
};

export function heading(page: Page, name: string) {
  return page.getByRole('heading', { level: 1, name });
}

export async function giveConsent(page: Page): Promise<void> {
  await expect(heading(page, 'Consent to use your biometric data')).toBeVisible();
  await page.getByRole('checkbox', { name: /^I agree/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

export async function uploadId(page: Page): Promise<void> {
  await expect(heading(page, 'Photograph your ID')).toBeVisible();
  await page.getByLabel('Choose a photo of the front of your ID').setInputFiles(FRONT);
  await page.getByRole('button', { name: 'Use this photo' }).click();
  await page.getByLabel('Choose a photo of the back of your ID').setInputFiles(BACK);
  await page.getByRole('button', { name: 'Use this photo' }).click();
}

/** What each pose's prompt is called: the upload label, the preview's alternative text. */
export const POSE_TEXTS = {
  center: {
    title: 'Look straight ahead',
    upload: 'Choose a selfie, looking straight ahead',
    alt: 'Your selfie, looking straight ahead',
  },
  left: {
    title: 'Turn your head to the left',
    upload: 'Choose a selfie, with your head turned to the left',
    alt: 'Your selfie, with your head turned to the left',
  },
  right: {
    title: 'Turn your head to the right',
    upload: 'Choose a selfie, with your head turned to the right',
    alt: 'Your selfie, with your head turned to the right',
  },
} as const;

export type Pose = keyof typeof POSE_TEXTS;

/** The live region that announces each prompt (C46.1). */
export function announcement(page: Page) {
  return page.getByTestId('selfie-announcement');
}

/**
 * The sandbox's selfie upload fallback (C19, C46.1): a capture of method `upload`, then each
 * prompted pose, in the server's order, chosen as a file and used.
 */
export async function uploadSelfie(page: Page, poses: readonly Pose[] = ['center']): Promise<void> {
  await expect(heading(page, 'Take a selfie')).toBeVisible();
  await page.getByRole('button', { name: 'Upload photos' }).click();
  for (const pose of poses) {
    await page.getByLabel(POSE_TEXTS[pose].upload).setInputFiles(SELFIE);
    await expect(page.getByRole('img', { name: POSE_TEXTS[pose].alt })).toBeVisible();
    await page.getByRole('button', { name: 'Use this photo' }).click();
  }
}

/**
 * The guided selfie with Chromium's fake camera (C46.1), whose test pattern shows no face: for
 * each prompt, in the server's order, the guidance runs, and the manual shutter appears after
 * 10 s. The page must have `page.clock.install()` before it loaded.
 */
export async function takeSelfie(page: Page, poses: readonly Pose[] = ['center']): Promise<void> {
  await expect(heading(page, 'Take a selfie')).toBeVisible();
  await page.getByRole('button', { name: 'Start the camera' }).click();
  const shutter = page.getByRole('button', { name: 'Capture' });
  for (const [index, pose] of poses.entries()) {
    await expect(announcement(page)).toContainText(
      `Photo ${String(index + 1)} of ${String(poses.length)}: ${POSE_TEXTS[pose].title}`,
    );
    await page.clock.fastForward(10_000);
    await expect(shutter).not.toHaveAttribute('aria-disabled', 'true');
    await shutter.click();
  }
}

/** Everything this tab keeps in sessionStorage, as `key=value` lines. */
export function storedInTab(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from({ length: window.sessionStorage.length }, (_, index) => {
      const key = window.sessionStorage.key(index) ?? '';
      return `${key}=${window.sessionStorage.getItem(key) ?? ''}`;
    }).join('\n'),
  );
}
