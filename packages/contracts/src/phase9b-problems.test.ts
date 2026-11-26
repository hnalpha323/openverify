/**
 * Workflow 9B Stage 1a (C174.8): the problem codes 9A did not add, one golden problem each.
 * - `problems/exports/`: saved views and exports (C165.2, C166.1); `export_too_large` keeps the
 *   status Phase 8's case export answers with (C138.1).
 * - `problems/access/`: environment-scoped access (C167.2, C168.1).
 * - `problems/cases/`: the case completions of C172 join Phase 8's case codes, so the console's
 *   `CASE_PROBLEM_WORDS` words them.
 * No problem echoes a received value (C143.5, rule 11): a pointer names a position, a detail names
 * a rule, and only ids, keys and permission names appear.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ACCESS_PROBLEM_STATUSES,
  CASE_PROBLEM_STATUSES,
  EXPORT_PROBLEM_STATUSES,
  problemSchema,
} from './problem.js';
import { listFixtures, readFixture } from './test-support.js';

const TITLES: Readonly<Record<number, string>> = {
  403: 'Forbidden',
  409: 'Conflict',
  422: 'Unprocessable Content',
};

const EXPORT_PROBLEMS: Readonly<Record<string, number>> = {
  saved_view_pii_filter: 422,
  export_too_large: 422,
  // Workflow 9D (K9-29): a list kind with no importer.
  export_list_kind_refused: 422,
};

const ACCESS_PROBLEMS: Readonly<Record<string, number>> = {
  role_scope_invalid: 422,
  no_environment_role: 403,
  user_more_privileged: 403,
  step_up_required: 403,
  // Workflow 9C (orchestrator decision AC2): PATCH never reactivates; POST /reactivate does.
  user_reactivation_required: 422,
};

const CASE_COMPLETION_PROBLEMS: Readonly<Record<string, number>> = {
  case_checklist_incomplete: 422,
  case_fields_required: 422,
  case_action_not_available: 403,
};

const fileOf = (code: string) => `${code.replaceAll('_', '-')}.json`;

/** K8-27's codes as each lands, one commit each (Workflow 9B (C)). */
const ADDED_K8_27: readonly string[] = [
  'case_template_invalid',
  'case_search_invalid',
  'attachment_scan_failed',
];

function expectGolden(path: string, code: string, status: number): void {
  const raw = readFixture(path);
  const problem = problemSchema.parse(raw);
  expect(problem).toEqual(raw);
  expect(problem).toMatchObject({ type: 'about:blank', title: TITLES[status], status, code });
  expect(z.encode(problemSchema, problem)).toEqual(raw);
  expect(problem.detail).not.toMatch(/[0-9]{4}|@/);
}

describe.each([
  ['exports', EXPORT_PROBLEM_STATUSES, EXPORT_PROBLEMS],
  ['access', ACCESS_PROBLEM_STATUSES, ACCESS_PROBLEMS],
] as const)('problems/%s/ (Workflow 9B, C174.8)', (folder, frozen, expected) => {
  it('freezes the problem codes with their statuses', () => {
    expect(frozen).toEqual(expected);
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it('holds one golden problem per code, named by it', () => {
    expect(listFixtures(`problems/${folder}`)).toEqual(Object.keys(expected).map(fileOf).sort());
  });

  it.each(Object.entries(expected))('carries code %s with status %d', (code, status) => {
    expectGolden(`problems/${folder}/${fileOf(code)}`, code, status);
  });
});

describe('the C172 case problems join the case codes (C172.2, C172.3, C172.5)', () => {
  it.each(Object.entries(CASE_COMPLETION_PROBLEMS))(
    'freezes %s with status %d and a golden problem in problems/cases/',
    (code, status) => {
      expect(CASE_PROBLEM_STATUSES).toMatchObject({ [code]: status });
      expect(listFixtures('problems/cases')).toContain(fileOf(code));
      expectGolden(`problems/cases/${fileOf(code)}`, code, status);
    },
  );
});

describe('the Workflow 9B problems reuse Phase 8 codes with Phase 8 statuses', () => {
  it('answers export_too_large as the case export does', () => {
    expect(EXPORT_PROBLEMS.export_too_large).toBe(CASE_PROBLEM_STATUSES.export_too_large);
  });
});

describe('the access problems name a position or permissions, never a person', () => {
  it('points user_reactivation_required at the status and names the reactivate route (AC2)', () => {
    const raw = readFixture('problems/access/user-reactivation-required.json') as {
      detail: string;
      errors: { location: string; pointer: string }[];
    };
    expect(raw.detail).toContain('/reactivate');
    expect(raw.errors).toEqual([
      expect.objectContaining({ location: 'body', pointer: '/data/attributes/status' }),
    ]);
  });

  it('points role_scope_invalid at the assignment that is too narrow', () => {
    const raw = readFixture('problems/access/role-scope-invalid.json') as {
      errors: { location: string; pointer: string }[];
    };
    expect(raw.errors).toEqual([
      expect.objectContaining({ location: 'body', pointer: '/assignments/0/environment-ids' }),
    ]);
  });
});

/**
 * K8-27 (carried from Phase 8, Workflow 8D Stage 1 api-carry-cases item 17; placed in 9B (C)): the
 * three case refusals Phase 8 answered unnamed join `CASE_PROBLEM_STATUSES`, each with its golden
 * problem in `problems/cases/`; `api-cases-reports` raises them.
 */
describe('K8-27: the named case problems', () => {
  const K8_27: readonly [string, number, string][] = [
    ['case_template_invalid', 422, 'field_type_changed'],
    ['case_search_invalid', 422, 'search_attribute_unknown'],
    ['attachment_scan_failed', 409, ''],
  ];

  it.each(K8_27.filter(([code]) => ADDED_K8_27.includes(code)))(
    '%s answers %d with its golden problem',
    (code, status, inner) => {
      expect(CASE_PROBLEM_STATUSES).toMatchObject({ [code]: status });
      const raw = readFixture(`problems/cases/${fileOf(code)}`);
      expectGolden(`problems/cases/${fileOf(code)}`, code, status);
      if (inner !== '') {
        // The errors[] keep the codes Phase 8 already answered with.
        expect(
          (raw as { errors: { code?: string }[] }).errors.map((error) => error.code),
        ).toContain(inner);
      }
    },
  );
});
