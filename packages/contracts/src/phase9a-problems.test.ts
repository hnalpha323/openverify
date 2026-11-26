/**
 * Workflow 9A Stage 1a (C174.8): the problem codes the flow engine, the template versions and the
 * theme sets raise, one golden problem each, in `problems/flow-engine/`, `problems/templates/` and
 * `problems/themes/` ((H)). No problem
 * echoes a received value (C143.5, rule 11): a pointer names a position, a detail names a rule,
 * and only ids, step ids, keys and sizes appear. Phase 8's `publish_acknowledgement_missing`,
 * `draft_exists`, `promote_unresolved` and `definition_invalid` are reused by name.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  FLOW_DEFINITION_PROBLEM_CODES,
  FLOW_ENGINE_PROBLEM_STATUSES,
  TEMPLATE_PROBLEM_STATUSES,
  THEME_PROBLEM_STATUSES,
  WORKFLOW_PROBLEM_STATUSES,
  problemSchema,
} from './problem.js';
import { listFixtures, readFixture } from './test-support.js';

const TITLES: Readonly<Record<number, string>> = {
  409: 'Conflict',
  412: 'Precondition Failed',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
};

const FLOW_ENGINE_PROBLEMS: Readonly<Record<string, number>> = {
  flow_step_not_current: 409,
  field_unknown: 422,
  field_write_once: 422,
  fields_too_large: 422,
  consent_text_mismatch: 422,
  selfie_capture_not_extendable: 409,
};

const TEMPLATE_PROBLEMS: Readonly<Record<string, number>> = {
  definition_invalid: 422,
  precondition_failed: 412,
  draft_exists: 409,
  promote_unresolved: 422,
  field_type_changed: 422,
  consent_copy_incomplete: 422,
  consent_copy_missing_placeholder: 422,
  locale_unsupported: 422,
  embed_origin_invalid: 422,
  embed_wildcard_unacknowledged: 422,
  redirect_uri_not_allowed: 422,
  publish_acknowledgement_missing: 422,
};

const THEME_PROBLEMS: Readonly<Record<string, number>> = {
  theme_contrast_insufficient: 422,
  theme_set_default: 409,
  asset_type_refused: 415,
};

const fileOf = (code: string) => `${code.replaceAll('_', '-')}.json`;

describe.each([
  ['flow-engine', FLOW_ENGINE_PROBLEM_STATUSES, FLOW_ENGINE_PROBLEMS],
  ['templates', TEMPLATE_PROBLEM_STATUSES, TEMPLATE_PROBLEMS],
  ['themes', THEME_PROBLEM_STATUSES, THEME_PROBLEMS],
] as const)('problems/%s/ (Workflow 9A, C174.8)', (folder, frozen, expected) => {
  it('freezes the problem codes with their statuses', () => {
    expect(frozen).toEqual(expected);
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it('holds one golden problem per code, named by it', () => {
    // Workflow 10B (C221.6): a second definition_invalid golden carries the device-integrity publish
    // rule codes (phase10b-contracts.test.ts).
    const extra = folder === 'templates' ? ['definition-invalid-integrity.json'] : [];
    expect(listFixtures(`problems/${folder}`).filter((name) => !extra.includes(name))).toEqual(
      Object.keys(expected).map(fileOf).sort(),
    );
  });

  it.each(Object.entries(expected))('carries code %s with status %d', (code, status) => {
    const raw = readFixture(`problems/${folder}/${fileOf(code)}`);
    const problem = problemSchema.parse(raw);
    expect(problem).toEqual(raw);
    expect(problem).toMatchObject({ type: 'about:blank', title: TITLES[status], status, code });
    expect(z.encode(problemSchema, problem)).toEqual(raw);
    expect(problem.detail).not.toMatch(/[0-9]{4}|@/);
  });
});

describe('the Workflow 9A problems reuse Phase 8 codes with Phase 8 statuses', () => {
  it('answers draft_exists, promote_unresolved, definition_invalid and the acknowledgement as workflows do', () => {
    for (const code of [
      'draft_exists',
      'promote_unresolved',
      'definition_invalid',
      'publish_acknowledgement_missing',
    ] as const) {
      expect(TEMPLATE_PROBLEMS[code]).toBe(WORKFLOW_PROBLEM_STATUSES[code]);
    }
  });
});

describe('the codes a v2 flow names inside definition_invalid (C147.6, C148, C150, C152)', () => {
  const codes = [
    'cycle_not_allowed',
    'action_error_edge_missing',
    'pattern_refused',
    'visibility_scope_invalid',
    'scope_path_unknown',
    'scope_path_unavailable_in_flow',
    'on_null_missing',
    'signal_wait_missing',
  ];

  it('freezes the codes C174.8 names', () => {
    expect(FLOW_DEFINITION_PROBLEM_CODES).toEqual(codes);
    expect(Object.isFrozen(FLOW_DEFINITION_PROBLEM_CODES)).toBe(true);
  });

  it('points each into the version, with its rule and never a value', () => {
    const raw = readFixture('problems/templates/definition-invalid.json') as {
      errors: { location: string; pointer: string; code: string }[];
    };
    expect(raw.errors.map((error) => error.code)).toEqual(codes);
    for (const error of raw.errors) {
      expect(error.location).toBe('body');
      expect(error.pointer).toMatch(/^\/data\/attributes\/flow\//);
    }
  });
});

describe('what the Workflow 9A problems say beside their code', () => {
  it('gives the size of the fields and the limit, never a value (C149.2, V17)', () => {
    expect(readFixture('problems/flow-engine/fields-too-large.json')).toMatchObject({
      size: 262_145,
      limit: 262_144,
    });
  });

  it('names an unknown field by its pointer alone (C149.3)', () => {
    expect(readFixture('problems/flow-engine/field-unknown.json')).toMatchObject({
      errors: [{ location: 'body', pointer: '/values/nickname' }],
    });
  });

  it('names each acknowledgement a publish lacks (C150.6, C150.7, C151.13)', () => {
    expect(readFixture('problems/templates/publish-acknowledgement-missing.json')).toMatchObject({
      errors: [
        {
          location: 'body',
          pointer: '/meta/acknowledgements',
          detail: 'adverse-path:failed_minor',
        },
        { location: 'body', pointer: '/meta/acknowledgements', detail: 'fallback:id_card' },
      ],
    });
  });

  it('names each refused origin by its position (C158.1)', () => {
    expect(readFixture('problems/templates/embed-origin-invalid.json')).toMatchObject({
      errors: [{ location: 'body', pointer: '/allowed-embed-origins/1' }],
    });
  });
});
