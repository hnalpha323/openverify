// @vitest-environment node
/**
 * C69.1: no console page meets a report type or status it has no words for. Each report type has
 * a label and a golden API fixture the console's contracts accept.
 */
import { readFileSync } from 'node:fs';
import { REPORT_RESOURCE_TYPES, reportDocumentSchema } from '@openverify/contracts';
import { REPORT_STATUSES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { REPORT_STATUS_LABELS, REPORT_TYPE_LABELS } from './labels';

const repo = (file: string) => new URL(`../../../../${file}`, import.meta.url);

describe('report types and statuses in the console (C69.1)', () => {
  it('labels every report type, in the registry order', () => {
    expect(Object.keys(REPORT_TYPE_LABELS)).toEqual([...REPORT_RESOURCE_TYPES]);
    expect(REPORT_TYPE_LABELS['report/politically-exposed-person']).toBe(
      'Politically exposed person',
    );
    expect(new Set(Object.values(REPORT_TYPE_LABELS)).size).toBe(REPORT_RESOURCE_TYPES.length);
  });

  it('labels every report status; errored reads as not screened, never as no match (C86)', () => {
    expect(Object.keys(REPORT_STATUS_LABELS)).toEqual([...REPORT_STATUSES]);
    expect(REPORT_STATUS_LABELS.errored).toBe('Errored (not screened)');
  });

  it.each(REPORT_RESOURCE_TYPES)('decodes the golden %s fixture', (type) => {
    const file = `contracts/fixtures/api/report-${type.slice('report/'.length)}.json`;
    const document = reportDocumentSchema.parse(JSON.parse(readFileSync(repo(file), 'utf8')));
    expect((document as { data: { type: string } }).data.type).toBe(type);
  });
});
