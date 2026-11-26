/**
 * C178.4 (Workflow 9B, integration-9b): theme sets on the full stack. Budget: 90 s per test.
 *
 * 1. A palette whose ink fails the contrast gate is refused with 422 `theme_contrast_insufficient`,
 *    naming the pair, its pointer and its unrounded ratio (C160.4; never rounded, rule 10).
 * 2. An accepted set with a logo uploaded through the vision rendition (C160.6) is applied to an
 *    inquiry's hosted flow: the page's `--color-primary` is the set's, and the header shows the
 *    logo from a `blob:` URL (C160.9), read with the session token.
 *
 * Every colour, name and image is synthetic; the logo is a PNG made by code (rule 9).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { expectStatus, serverRequest, syntheticPng } from './support/platform-9b.js';
import { recordingClient } from './support/platform.js';

const themeSet = (name: string, styles: Record<string, unknown>) => ({
  data: { type: 'theme-set', attributes: { name, styles } },
});

test('a palette below the contrast minimum is refused, naming the pair and its unrounded ratio (C160.4)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();

  const refused = await serverRequest(
    stack,
    stack.apiKey,
    'POST',
    '/theme-sets',
    themeSet(`e2e low contrast ${randomUUID().slice(0, 8)}`, {
      light: { palette: { ink: '#777777' } },
    }),
  );

  expect(refused.status, JSON.stringify(refused.body)).toBe(422);
  const problem = refused.body as {
    code: string;
    pairs: { pointer: string; ratio: number; required: number }[];
  };
  expect(problem.code).toBe('theme_contrast_insufficient');
  const ink = problem.pairs.find(
    (pair) => pair.pointer === '/data/attributes/styles/light/palette/ink',
  );
  expect(ink).toBeDefined();
  expect(ink?.ratio).toBeLessThan(ink?.required ?? 0);
  // Unrounded: #777777 on white is 4.4806…, never shown as 4.5.
  expect(String(ink?.ratio).length).toBeGreaterThan(4);
});

test('an accepted set with an uploaded logo is applied to the hosted flow (C160.6, C160.9)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const form = new FormData();
  form.append('kind', 'logo');
  form.append('file', new Blob([syntheticPng(64, 32)], { type: 'image/png' }), 'logo.png');
  const asset = expectStatus(
    await serverRequest(stack, stack.apiKey, 'POST', '/theme-sets/assets', form),
    201,
    'the logo upload',
  ).body as { data: { id: string; attributes: { 'media-type': string } } };
  expect(asset.data.attributes['media-type']).toBe('image/png');

  const created = expectStatus(
    await serverRequest(
      stack,
      stack.apiKey,
      'POST',
      '/theme-sets',
      themeSet(`e2e brand ${randomUUID().slice(0, 8)}`, {
        light: { palette: { primary: '#2563eb' } },
        branding: { logo: { 'asset-id': asset.data.id, decorative: true } },
      }),
    ),
    201,
    'the theme set',
  ).body as { data: { id: string } };

  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `e2e-theme-${randomUUID()}`,
    'theme-set-id': created.data.id,
  });
  const resumed = await client.inquiries.resume(inquiry.id);

  await page.goto(resumed.meta['flow-url']);
  await expect
    .poll(() =>
      // Workflow 9C: the flow writes the theme to a rule of its own stylesheet, never the root's
      // inline style (WebKit's style-src-attr check), so the token is read as computed.
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim(),
      ),
    )
    .toBe('#2563eb');
  const logo = page.locator('header img');
  await expect(logo).toHaveAttribute('src', /^blob:/);
  // A decorative logo has no alt text (C160.6).
  await expect(logo).toHaveAttribute('alt', '');
});
