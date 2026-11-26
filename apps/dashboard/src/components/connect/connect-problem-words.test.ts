import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONNECT_PROBLEM_CODES,
  CONSENT_REQUIRED_REASONS,
  problemSchema,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import type { DisplayProblem } from '../../lib/action-state';
import {
  CONNECT_PROBLEM_WORDS,
  CONSENT_REQUIRED_REASON_WORDS,
  describeConnectProblem,
} from './connect-problem-words';
import { CONTRACT_FIXTURES } from './connect-fixtures';

const GOLDENS = join(CONTRACT_FIXTURES, 'problems', 'connect');

/** A golden problem (`contracts/fixtures/problems/connect/`) as the console's actions show it. */
function goldenDisplay(file: string): DisplayProblem & { readonly reason?: string } {
  const problem = problemSchema
    .loose()
    .parse(JSON.parse(readFileSync(join(GOLDENS, file), 'utf8')));
  return {
    title: problem.title,
    detail: problem.detail,
    status: problem.status,
    ...(problem.code === undefined ? {} : { code: problem.code }),
    ...(typeof problem.reason === 'string' ? { reason: problem.reason } : {}),
  };
}

describe('Connect’s problems in words (C242: every problem code in words)', () => {
  it('words every Connect code and the step-up code, each its own sentence', () => {
    expect(Object.keys(CONNECT_PROBLEM_WORDS).sort()).toEqual(
      [...CONNECT_PROBLEM_CODES, 'step_up_required'].sort(),
    );
    const sentences = Object.values(CONNECT_PROBLEM_WORDS);
    expect(new Set(sentences).size).toBe(sentences.length);
    for (const sentence of sentences) {
      expect(sentence).toMatch(/^[A-Z].*[.]$/);
    }
  });

  it('words every reason of consent_required', () => {
    expect(Object.keys(CONSENT_REQUIRED_REASON_WORDS).sort()).toEqual(
      [...CONSENT_REQUIRED_REASONS].sort(),
    );
  });

  it.each(
    readdirSync(GOLDENS).filter((file) => file.endsWith('.json') && file !== 'not-found.json'),
  )('titles the golden %s in words and keeps its detail', (file) => {
    const golden = goldenDisplay(file);
    const shown = describeConnectProblem(golden, golden.reason);

    expect(shown.title).not.toBe(golden.title);
    expect(shown.title).toBe(
      CONNECT_PROBLEM_WORDS[golden.code as keyof typeof CONNECT_PROBLEM_WORDS],
    );
    expect(shown.status).toBe(golden.status);
  });

  it('says why a consent does not cover a share, from its reason', () => {
    const golden = goldenDisplay('consent-required.json');

    expect(describeConnectProblem(golden, 'categories').detail).toBe(
      CONSENT_REQUIRED_REASON_WORDS.categories,
    );
    expect(describeConnectProblem(golden, 'not-a-reason').detail).toBe(golden.detail);
  });

  it('leaves the one generic 404 and any other problem as the API said it', () => {
    const notFound = goldenDisplay('not-found.json');
    const other: DisplayProblem = { title: 'Conflict', code: 'invalid_transition', status: 409 };

    expect(describeConnectProblem(notFound)).toEqual(notFound);
    expect(describeConnectProblem(other)).toEqual(other);
  });

  it('says the step-up in words, so the operator knows to enter a code', () => {
    const shown = describeConnectProblem({ title: 'Forbidden', code: 'step_up_required' });

    expect(shown.title).toBe(CONNECT_PROBLEM_WORDS.step_up_required);
    expect(shown.title).toMatch(/second factor/);
  });
});
