// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPORT_PROBLEM_CODES, type ReportProblemCode } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { REPORT_PROBLEM_WORDS, describeReportProblem } from './report-problem-words';

const PROBLEMS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'contracts',
  'fixtures',
  'problems',
  'reports',
);

/** The golden problem of `code` (`contracts/fixtures/problems/reports/`), as the API sends it. */
function golden(code: ReportProblemCode): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(PROBLEMS, `${code.replaceAll('_', '-')}.json`), 'utf8'),
  ) as Record<string, unknown>;
}

describe('report problems in words (C72.4, C86)', () => {
  it.each(REPORT_PROBLEM_CODES)('says the problem %s in words', (code) => {
    expect(REPORT_PROBLEM_WORDS[code]).toMatch(/^[A-Z][^_]*\.$/);
  });

  it('words exactly the contract codes, in their order', () => {
    expect(Object.keys(REPORT_PROBLEM_WORDS)).toEqual([...REPORT_PROBLEM_CODES]);
  });

  it.each(REPORT_PROBLEM_CODES)(
    'titles a refusal with %s in words, keeping the detail, errors and reference of the golden problem',
    (code) => {
      const problem = golden(code);
      const shown = describeReportProblem({
        title: String(problem.title),
        detail: String(problem.detail),
        status: Number(problem.status),
        requestId: String(problem.requestId),
        code,
        ...(Array.isArray(problem.errors)
          ? {
              errors: (problem.errors as { pointer: string; detail: string }[]).map((error) => ({
                pointer: error.pointer,
                detail: error.detail,
              })),
            }
          : {}),
      });

      expect(shown.title).toBe(REPORT_PROBLEM_WORDS[code]);
      expect(shown.detail).toBe(problem.detail);
      expect(shown.requestId).toBe(problem.requestId);
      expect(shown.code).toBe(code);
    },
  );

  it('says a superseded match names the match to review instead (C75.8, V07)', () => {
    expect(REPORT_PROBLEM_WORDS.report_match_superseded).toBe(
      'A later match of the same entry replaced this one: review that match instead.',
    );
  });

  it('leaves a problem without a report code as the API titled it', () => {
    const problem = { title: 'Conflict', detail: 'Synthetic.', code: 'invalid_transition' };
    expect(describeReportProblem(problem)).toBe(problem);
    expect(describeReportProblem({ title: 'Bad Request' })).toEqual({ title: 'Bad Request' });
  });
});
