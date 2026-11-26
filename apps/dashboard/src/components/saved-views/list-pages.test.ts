// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAVED_VIEW_LISTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';

/** The `app/` folder read (the RED evidence read the pages as they were in git). */
const APP =
  process.env.SAVED_VIEW_PAGES_ROOT ??
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');

/** C165.1: every list a view can name, and the page whose one line mounts its slot. */
const PAGES: Readonly<Record<(typeof SAVED_VIEW_LISTS)[number], string>> = {
  inquiries: 'inquiries/page.tsx',
  accounts: 'accounts/page.tsx',
  reports: 'reports/page.tsx',
  cases: 'cases/page.tsx',
  transactions: 'transactions/page.tsx',
  'api-logs': 'api-logs/page.tsx',
  'webhook-deliveries': 'webhooks/[id]/page.tsx',
  events: 'events/page.tsx',
  'audit-logs': 'audit-logs/page.tsx',
};

describe('the saved-views slot on every C165.1 list page', () => {
  it.each(SAVED_VIEW_LISTS)('the %s list page mounts it once', (list) => {
    const source = readFileSync(join(APP, PAGES[list]), 'utf8');

    expect(source.match(new RegExp(`<SavedViewsSlot list="${list}" />`, 'g'))).toHaveLength(1);
  });
});
