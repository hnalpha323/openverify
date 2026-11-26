/**
 * Workflow 9C (`dashboard-themes-copy`): helpers of `ui-themes-copy.spec.ts`. Each object the spec
 * makes carries a random suffix, so it never meets another run's on a reused stack, and is ended by
 * the spec's `afterAll`. Every value is synthetic: names, colours, texts and the logo made by code.
 */
import { randomUUID } from 'node:crypto';
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import type { StackInfo } from '../../src/stack-info.js';
import { recordingClient } from './platform.js';

/** A short random suffix. */
export const themesCopySuffix = (): string => randomUUID().replaceAll('-', '').slice(0, 10);

/** C162.7: a text a spreadsheet would run as a formula; the export neutralises it. */
export const FORMULA_TEXT = '=SUM(4,5) synthetic heading';
export const ARABIC_TEXT = 'عنوان تجريبي';
export const COPY_KEY = 'completion.title';

/** A theme set with every cell built in; `archiveSpecThemeSet` ends it. */
export async function specThemeSet(stack: StackInfo, suffix: string): Promise<string> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data } = await client.themeSets.create({ name: `e2e ui theme ${suffix}`, styles: {} });
  return data.id;
}

/** Archives the spec's set; an already archived or missing set is left as it is. */
export async function archiveSpecThemeSet(stack: StackInfo, id: string | undefined): Promise<void> {
  if (id === undefined) {
    return;
  }
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  await client.themeSets.archive(id).catch(() => undefined);
}

export interface CopyTemplate {
  readonly templateId: string;
  readonly draftId: string;
}

/**
 * A template whose draft enables English and Arabic and words one built-in text in English as a
 * formula-like text; the draft is never published.
 */
export async function specCopyTemplate(stack: StackInfo, suffix: string): Promise<CopyTemplate> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const defaults = defaultInquiryTemplateAttributes();
  const { data: template } = await client.inquiryTemplates.create({
    ...defaults,
    name: `e2e ui translations ${suffix}`,
  });
  const { data: draft } = await client.inquiryTemplateVersions.create({
    'inquiry-template-id': template.id,
    flow: defaults.flow,
    'verification-config': defaults['verification-config'],
    'enabled-locales': ['en', 'ar'],
    'default-locale': 'en',
    copy: { messages: { en: { [COPY_KEY]: FORMULA_TEXT } } },
  } as never);
  return { templateId: template.id, draftId: draft.id };
}

/** Archives the spec's template, so no inquiry can use it. */
export async function archiveSpecTemplate(
  stack: StackInfo,
  made: CopyTemplate | undefined,
): Promise<void> {
  if (made === undefined) {
    return;
  }
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  await client.inquiryTemplates.update(made.templateId, { status: 'archived' });
}

/** One CSV record, every cell quoted as the export writes them. */
export const csvRecord = (cells: readonly string[]): string =>
  cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',');
