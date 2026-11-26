/**
 * C69.1, C87 (Workflow 6A integration): every report type has its page in `docs/reports/`, which
 * says what a result means and states the type's stage as the registry does, and the overview
 * holds what C87 asks of it: the lawful-basis note, a disclosure per adapter, the completion
 * window, the Postgres logging warning and the retention setting. The docs half of C69.1's
 * registry test (Stage 1a amendment 9).
 */
import { existsSync, readFileSync } from 'node:fs';
import { REPORT_REGISTRY, REPORT_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';

const DOCS = new URL('../../../docs/reports/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DOCS), 'utf8');

describe('docs/reports (C69.1, C87)', () => {
  it.each(REPORT_TYPES)('has a page for %s that says what a result means and its stage', (type) => {
    const page = new URL(`${type}.md`, DOCS);
    expect(existsSync(page), `docs/reports/${type}.md`).toBe(true);
    const text = readFileSync(page, 'utf8');
    expect(text).toContain(`\`report/${type}\``);
    expect(text).toMatch(/^## What a result means$/mu);
    expect(text).toContain(`**Stage:** \`${REPORT_REGISTRY[type].stage}\``);
    expect(read('README.md')).toContain(`(${type}.md)`);
  });

  it('holds the lawful-basis note, the adapter disclosures, the completion window, the logging warning and the retention setting', () => {
    const overview = read('README.md');
    for (const heading of [
      '## Privacy',
      '## What each adapter receives',
      '## Reports on inquiry completion',
    ]) {
      expect(overview).toContain(heading);
    }
    for (const term of [
      '**Lawful basis.**',
      '**The completion window.**',
      'log_parameter_max_length=0',
      'report-retention-days',
      'gdelt-doc',
      'OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE',
      'hibp',
      'twilio-lookup',
      'smarty',
      'watchlists:rekey',
      'build:variant-groups',
    ]) {
      expect(overview, term).toContain(term);
    }
  });
});
