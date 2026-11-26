/**
 * C24 spec 10 helpers: one-time links made through the server API (C10) as a customer backend
 * makes them, and what the hosted flow keeps in the browser tab.
 */
import { randomUUID } from 'node:crypto';
import type { SelfiePose } from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import { expect, type Page } from '@playwright/test';
import type { StackInfo } from '../../src/stack-info.js';
import { currentPrompt, selfieAnnouncement } from './flow.js';

export interface LinkedInquiry {
  readonly inquiryId: string;
  /** `${flowUrl}/#inquiry-id=…&one-time-token=ovo_…` */
  readonly link: string;
}

/** A new inquiry on the default template, and a one-time link to it. */
export async function inquiryWithOneTimeLink(
  client: OpenVerifyClient,
  stack: StackInfo,
  label: string,
): Promise<LinkedInquiry> {
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `e2e-${label}-${randomUUID()}`,
  });
  const { meta } = await client.inquiries.generateOneTimeLink(inquiry.id, {
    'expires-in-seconds': 600,
  });
  return { inquiryId: inquiry.id, link: meta['one-time-link'] };
}

export function heading(page: Page, name: string) {
  return page.getByRole('heading', { level: 1, name });
}

/** Each pose's file input and preview in the selfie step's upload mode (C46.1). */
const UPLOAD_TEXTS: Readonly<Record<SelfiePose, { label: string; alt: string }>> = Object.freeze({
  center: {
    label: 'Choose a selfie, looking straight ahead',
    alt: 'Your selfie, looking straight ahead',
  },
  left: {
    label: 'Choose a selfie, with your head turned to the left',
    alt: 'Your selfie, with your head turned to the left',
  },
  right: {
    label: 'Choose a selfie, with your head turned to the right',
    alt: 'Your selfie, with your head turned to the right',
  },
});

/**
 * The sandbox's selfie upload fallback (C19, C46.1), after the ID was checked: an `upload`
 * capture, then every prompted pose in the server's order, each chosen as a file and used.
 * Returns the prompted poses in order.
 */
export async function uploadSelfie(
  page: Page,
  fileFor: (pose: SelfiePose) => string,
): Promise<SelfiePose[]> {
  await expect(heading(page, 'Take a selfie')).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Upload photos' }).click();
  const status = selfieAnnouncement(page);
  await expect(status).toHaveText(/Photo 1 of \d+: /);
  const { total } = await currentPrompt(page);
  const poses: SelfiePose[] = [];
  for (let index = 1; index <= total; index += 1) {
    await expect(status).toHaveText(new RegExp(`Photo ${String(index)} of ${String(total)}: `));
    const { pose } = await currentPrompt(page);
    await page.getByLabel(UPLOAD_TEXTS[pose].label).setInputFiles(fileFor(pose));
    await expect(page.getByRole('img', { name: UPLOAD_TEXTS[pose].alt })).toBeVisible();
    await page.getByRole('button', { name: 'Use this photo' }).click();
    poses.push(pose);
  }
  return poses;
}

/** Everything the tab keeps in sessionStorage, as `key=value` lines. */
export function storedInTab(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from({ length: window.sessionStorage.length }, (_, index) => {
      const key = window.sessionStorage.key(index) ?? '';
      return `${key}=${window.sessionStorage.getItem(key) ?? ''}`;
    }).join('\n'),
  );
}
