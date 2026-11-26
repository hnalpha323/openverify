import {
  WORKFLOW_ACKNOWLEDGEMENT_KINDS,
  WORKFLOW_DELIVERY_STATUSES,
  WORKFLOW_ERROR_TYPES,
  WORKFLOW_PAUSED_REASONS,
  WORKFLOW_RUN_CREATOR_TYPES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_RUN_WAITING_ON,
  WORKFLOW_STATUSES,
  WORKFLOW_STEP_STATUSES,
  WORKFLOW_TRIGGER_TYPES,
  WORKFLOW_VERSION_STATUSES,
} from '@openverify/core';
import { WORKFLOW_PROBLEM_CODES } from '@openverify/contracts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_DEFINITION_PROBLEM_WORDS,
  WORKFLOW_PROBLEM_WORDS,
  WORKFLOW_STEP_ERROR_WORDS,
  definitionProblemWords,
  stepErrorWords,
  WORKFLOW_ACKNOWLEDGEMENT_WORDS,
  WORKFLOW_DELIVERY_STATUS_WORDS,
  WORKFLOW_ERROR_TYPE_WORDS,
  WORKFLOW_PAUSED_REASON_WORDS,
  WORKFLOW_RUN_CREATOR_WORDS,
  WORKFLOW_RUN_STATUS_WORDS,
  WORKFLOW_RUN_WAITING_ON_WORDS,
  WORKFLOW_STATUS_WORDS,
  WORKFLOW_STEP_STATUS_WORDS,
  WORKFLOW_TRIGGER_TYPE_WORDS,
  WORKFLOW_VERSION_STATUS_WORDS,
  runStatusWords,
  wordOf,
} from './workflow-words';

describe('every workflow and run value in words (C120, C141)', () => {
  it.each([
    ['workflow statuses', WORKFLOW_STATUSES, WORKFLOW_STATUS_WORDS],
    ['paused reasons', WORKFLOW_PAUSED_REASONS, WORKFLOW_PAUSED_REASON_WORDS],
    ['version statuses', WORKFLOW_VERSION_STATUSES, WORKFLOW_VERSION_STATUS_WORDS],
    ['trigger types', WORKFLOW_TRIGGER_TYPES, WORKFLOW_TRIGGER_TYPE_WORDS],
    ['run statuses', WORKFLOW_RUN_STATUSES, WORKFLOW_RUN_STATUS_WORDS],
    ['waiting-on values', WORKFLOW_RUN_WAITING_ON, WORKFLOW_RUN_WAITING_ON_WORDS],
    ['run creators', WORKFLOW_RUN_CREATOR_TYPES, WORKFLOW_RUN_CREATOR_WORDS],
    ['step statuses', WORKFLOW_STEP_STATUSES, WORKFLOW_STEP_STATUS_WORDS],
    ['trigger delivery statuses', WORKFLOW_DELIVERY_STATUSES, WORKFLOW_DELIVERY_STATUS_WORDS],
    ['error types', WORKFLOW_ERROR_TYPES, WORKFLOW_ERROR_TYPE_WORDS],
    ['acknowledgement kinds', WORKFLOW_ACKNOWLEDGEMENT_KINDS, WORKFLOW_ACKNOWLEDGEMENT_WORDS],
  ] as const)('says every one of the %s', (_name, values, words) => {
    const missing = values.filter((value) => (words[value] ?? '').trim() === '');

    expect(missing).toEqual([]);
    expect(Object.keys(words).sort()).toEqual([...values].sort());
  });

  it('never says a canceled or timed-out step succeeded', () => {
    expect(WORKFLOW_STEP_STATUS_WORDS.timed_out).toBe('Timed out');
    expect(WORKFLOW_STEP_STATUS_WORDS.canceled).toBe('Canceled');
    expect(WORKFLOW_RUN_STATUS_WORDS.in_progress).toBe('In progress');
  });

  it('keeps a value the console does not know, rather than hiding it', () => {
    expect(wordOf(WORKFLOW_RUN_STATUS_WORDS, 'something_new')).toBe('something_new');
  });
});

/**
 * The engine's and the actions' codes live in `@openverify/workflow-engine`, which the console does
 * not depend on; `docs/workflows/errors.md` is generated from those lists and
 * `reference-docs.test.ts` fails it when stale, so the test reads the source lists through it.
 */
const ERRORS_DOC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../../docs/workflows/errors.md'),
  'utf8',
);

function sectionOf(title: string): string {
  const start = ERRORS_DOC.indexOf(`## ${title}\n`);
  const end = ERRORS_DOC.indexOf('\n## ', start + 1);
  return ERRORS_DOC.slice(start, end === -1 ? undefined : end);
}

const tableCodes = (title: string): string[] =>
  [...sectionOf(title).matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map((match) => String(match[1]));

const bulletCodes = (title: string): string[] => [
  ...new Set([...sectionOf(title).matchAll(/`([a-z][a-z0-9_]+)`/g)].map((m) => String(m[1]))),
];

describe('every problem and step error in words (C112.8, C113.6, C120.2)', () => {
  const STEP_ERRORS = [...tableCodes('Engine'), ...tableCodes('Actions')];
  const DEFINITION_PROBLEMS = bulletCodes('Definitions').filter(
    (code) => code !== 'definition_invalid',
  );

  it('reads the source lists before it reads the words', () => {
    expect(STEP_ERRORS.length).toBeGreaterThan(90);
    expect(STEP_ERRORS).toContain('condition_input_null');
    expect(STEP_ERRORS).toContain('provider_not_configured');
    expect(DEFINITION_PROBLEMS.length).toBeGreaterThan(90);
    expect(DEFINITION_PROBLEMS).toContain('on_null_missing');
    expect(DEFINITION_PROBLEMS).toContain('publisher_scope_lost');
  });

  it.each([
    ['step error codes', STEP_ERRORS, WORKFLOW_STEP_ERROR_WORDS],
    ['definition problem codes', DEFINITION_PROBLEMS, WORKFLOW_DEFINITION_PROBLEM_WORDS],
    ['workflow problem codes', WORKFLOW_PROBLEM_CODES, WORKFLOW_PROBLEM_WORDS],
  ] as const)('says every one of the %s', (_name, codes, words) => {
    const missing = codes.filter((code) => (words[code] ?? '').trim() === '');

    expect(missing).toEqual([]);
  });

  it('says a code it knows in words, and keeps one it does not rather than hiding it', () => {
    expect(stepErrorWords('wait_timed_out')).toBe(WORKFLOW_STEP_ERROR_WORDS.wait_timed_out);
    expect(stepErrorWords('slack_channel_not_found')).toBe(
      'Slack refused the message (channel_not_found)',
    );
    expect(stepErrorWords('something_new')).toBe('something_new');
    expect(definitionProblemWords('on_null_missing')).toBe(
      WORKFLOW_DEFINITION_PROBLEM_WORDS.on_null_missing,
    );
    expect(definitionProblemWords('something_new')).toBe('something_new');
  });

  it('never words an unknown as false, or a recorded message as sent (ADR 0002, ADR 0007)', () => {
    const all = [
      ...Object.values(WORKFLOW_STEP_ERROR_WORDS),
      ...Object.values(WORKFLOW_DEFINITION_PROBLEM_WORDS),
    ].join(' ');

    expect(all).not.toMatch(/\b(sent|delivered|clean)\b/i);
    expect(WORKFLOW_STEP_ERROR_WORDS.unknown_effect).toMatch(/not known/);
    expect(WORKFLOW_STEP_ERROR_WORDS.list_unavailable).toMatch(/not screened/);
  });
});

describe('runStatusWords (C120.1, H32)', () => {
  const none = { 'failed-continued': 0, 'timed-out': 0, 'unknown-effect': 0 };

  it('says a clean run as its status', () => {
    expect(runStatusWords('completed', none)).toBe('Completed');
  });

  it('says a completed run with step errors so, counting each kind', () => {
    expect(runStatusWords('completed', { ...none, 'failed-continued': 2, 'timed-out': 1 })).toBe(
      'Completed with 3 step errors',
    );
    expect(runStatusWords('completed', { ...none, 'failed-continued': 1 })).toBe(
      'Completed with 1 step error',
    );
  });

  it('says an unknown effect as an unknown outcome, never as done', () => {
    expect(runStatusWords('completed', { ...none, 'unknown-effect': 1 })).toBe(
      'Completed with 1 step error (1 outcome unknown)',
    );
  });
});
