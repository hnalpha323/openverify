/**
 * C154.8 (Workflow 9A Stage 1a, (T)): a template version and a deployment resolve through their
 * template and are strict, so neither reaches a webhook filtered on another template or on an
 * account type.
 */
import { readFileSync } from 'node:fs';
import type { Db } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { eventFilterSubjects } from './subject.js';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../../contracts/fixtures/api/${name}`, import.meta.url), 'utf8'),
  ) as { data: { attributes: { payload: unknown } } };

const TEMPLATE = 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6';

describe('the template subjects (C154.8)', () => {
  it.each([
    'event-inquiry-template-version-created.json',
    'event-inquiry-template-version-published.json',
    'event-deployment-completed.json',
  ])('%s resolves through its template, strictly', async (name) => {
    const payload = fixture(name).data.attributes.payload;
    const [subject] = await eventFilterSubjects({} as Db, 'env_01M5CJZC30W7PFE0GD30HJWEC5', [
      payload,
    ]);
    expect(subject).toEqual({ inquiryTemplateId: TEMPLATE, strict: true });
  });
});
