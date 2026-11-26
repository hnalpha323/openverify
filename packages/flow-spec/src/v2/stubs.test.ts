/**
 * Workflow 9A Stage 1a froze these exports as stubs that threw `FlowSpecNotBuiltError`; Stage 2
 * (`flow-spec-logic`) built each, test-first, with its own tests. This guard keeps the list: none
 * of them may throw "not built" again, and the package index still exports each.
 */
import { describe, expect, it } from 'vitest';
import {
  FlowSpecNotBuiltError,
  canonicalFlowJson,
  checkFlowGraph,
  checkVisibilityRule,
  clientViewOf,
  compilePattern,
  deviceKindOf,
  evaluateVisibility,
  fieldReferences,
  flowOutcome,
  flowV2JsonSchema,
  matchPattern,
  migrateFlow,
  migrateFlowWithNotes,
  nextPosition,
  normalizeDigits,
  projection,
  scopeJsonSchema,
  type FlowV2,
} from '../index.js';
import { completion, consent, flowOf } from './test-flows.js';

const flow: FlowV2 = flowOf([consent(), completion()], [['consent', 'next', 'done']]);
const position = {
  current: 'consent',
  exited: [],
  verificationStatuses: {},
  consentRecorded: false,
  customConsentCopy: false,
};
const built: [string, () => unknown][] = [
  ['checkFlowGraph', () => checkFlowGraph(flow)],
  ['canonicalFlowJson', () => canonicalFlowJson(flow)],
  ['migrateFlow', () => migrateFlow(flow)],
  ['migrateFlowWithNotes', () => migrateFlowWithNotes(flow)],
  [
    'nextPosition',
    () => nextPosition(flow, {}, 'consent', 'next', () => ({ outcome: 'value', value: true })),
  ],
  ['flowOutcome', () => flowOutcome([], {}, [])],
  ['projection', () => projection(flow, position)],
  ['clientViewOf', () => clientViewOf({ id: 'done', type: 'completion' })],
  ['checkVisibilityRule', () => checkVisibilityRule({ '!!': [true] }, [])],
  ['evaluateVisibility', () => evaluateVisibility(undefined, {})],
  ['fieldReferences', () => fieldReferences({ flow })],
  ['normalizeDigits', () => normalizeDigits('1')],
  ['deviceKindOf', () => deviceKindOf({ deviceType: null, mobileSdkName: null })],
  ['scopeJsonSchema', () => scopeJsonSchema({ paths: [] })],
  ['flowV2JsonSchema', () => flowV2JsonSchema()],
  ['compilePattern', () => compilePattern('a')],
  ['matchPattern', () => matchPattern({ source: 'a' }, 'a')],
];

describe('the frozen flow-spec-logic exports (built in Workflow 9A Stage 2)', () => {
  it.each(built)('%s is built', (_name, call) => {
    let thrown: unknown = null;
    try {
      call();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).not.toBeInstanceOf(FlowSpecNotBuiltError);
    expect(thrown).toBeNull();
  });
});
