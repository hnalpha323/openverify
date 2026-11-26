/**
 * The document contract (C51.2): the reasons each document evaluator of `@openverify/checks` may
 * emit are exactly the ones `@openverify/contracts` lists for its check (the checks package cannot
 * import contracts, so the two meet here); every result the evaluators give on vision's golden
 * analyses, each refusal the job maps and vision's failure, with and without references, carries
 * only listed reasons, a valid C29 shape and no extracted value; and every refusal vision answers
 * (C60.1) maps to a frozen user-behaviour reason of the type check, never to a fraud reason.
 * Every value is synthetic.
 */
import {
  DOCUMENT_EVALUATOR_REASONS,
  documentVisionRefusalOf,
  evaluateDocument,
  type DocumentCheckInput,
  type DocumentVisionOutcome,
} from '@openverify/checks';
import {
  DOCUMENT_CHECK_IDS,
  DOCUMENT_CHECK_REASONS,
  PHASE5_RETRY_HINT_REASONS,
} from '@openverify/contracts';
import { checkResultSchema, defaultTemplateConfig, type CheckResult } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_PROBLEM_CODES } from '../vision/schemas.js';
import { documentAnalysisFixture } from './testing.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');
const PRINTED = ['QUINN', 'VALEMONT', 'LANTERN', 'MERIDALE', 'UTOPIA WATER', '2026-09-30'];

/** What vision can answer for a document: two golden analyses, each refusal, a failure, nothing. */
function visionOutcomes(): (DocumentVisionOutcome | null)[] {
  const covered = documentAnalysisFixture();
  const visible = documentAnalysisFixture();
  for (const page of visible.pages) {
    page.text_layer = page.text_layer.filter((line) => line.visible);
  }
  return [
    { kind: 'analysis', analysis: covered },
    { kind: 'analysis', analysis: visible },
    { kind: 'analysis', analysis: documentAnalysisFixture('analyze-document-image') },
    ...(['too_large', 'too_many_pages', 'password_protected', 'unreadable'] as const).map(
      (refusal): DocumentVisionOutcome => ({ kind: 'refused', refusal }),
    ),
    { kind: 'error' },
    null,
  ];
}

const REFERENCES: NonNullable<DocumentCheckInput['references']>[] = [
  {},
  {
    inquiry: {
      name: { first: 'Quinn', last: 'Valemont' },
      address: {
        street1: '14 Lantern Row',
        city: 'Meridale',
        postalCode: '00000',
        countryCode: 'US',
      },
    },
  },
  { inquiry: { name: { first: 'Avery', last: 'Example' }, address: { postalCode: '99999' } } },
];

function results(): CheckResult[] {
  const config = defaultTemplateConfig('document');
  return visionOutcomes().flatMap((vision) =>
    REFERENCES.flatMap((references) =>
      (['utility_bill', 'bank_statement'] as const).flatMap(
        (accepted) =>
          evaluateDocument({ vision, acceptedTypes: [accepted], references, now: NOW }, config)
            .results,
      ),
    ),
  );
}

describe('the document contract (C51.2)', () => {
  it('lets each evaluator emit exactly the reasons the contracts list for its check', () => {
    expect(Object.keys(DOCUMENT_EVALUATOR_REASONS).sort()).toEqual([...DOCUMENT_CHECK_IDS].sort());
    for (const id of DOCUMENT_CHECK_IDS) {
      expect([...(DOCUMENT_EVALUATOR_REASONS[id] ?? [])].sort(), id).toEqual(
        [...DOCUMENT_CHECK_REASONS[id]].sort(),
      );
    }
  });

  it('gives only listed reasons, a valid result and no extracted value, on every vision answer', () => {
    const reached = new Set<string>();

    for (const result of results()) {
      expect(checkResultSchema.safeParse(result).success, result.name).toBe(true);
      const listed: readonly string[] =
        DOCUMENT_CHECK_REASONS[result.name as (typeof DOCUMENT_CHECK_IDS)[number]];
      for (const reason of result.reasons) {
        expect(listed, `${result.name}: ${reason}`).toContain(reason);
        reached.add(`${result.name}:${reason}`);
      }
      const serialized = JSON.stringify(result);
      for (const value of PRINTED) {
        expect(serialized, result.name).not.toContain(value);
      }
    }
    expect(reached.size).toBeGreaterThanOrEqual(12);
  });

  it('maps every refusal vision answers to a frozen user-behaviour reason of the type check', () => {
    const retryable: readonly string[] = PHASE5_RETRY_HINT_REASONS;
    const statuses: [number, string | null][] = [
      [413, null],
      [415, null],
      [422, null],
      ...DOCUMENT_PROBLEM_CODES.map((code): [number, string] => [422, code]),
    ];
    const config = defaultTemplateConfig('document');

    for (const [status, code] of statuses) {
      const refusal = documentVisionRefusalOf(status, code);
      const [type] = evaluateDocument(
        { vision: { kind: 'refused', refusal }, acceptedTypes: ['utility_bill'], now: NOW },
        config,
      ).results;
      expect(type, `${String(status)} ${String(code)}`).toMatchObject({
        name: 'document_type_detection',
        status: 'failed',
        type: 'user_behavior',
      });
      for (const reason of type?.reasons ?? []) {
        expect(retryable, reason).toContain(reason);
      }
    }
  });
});
