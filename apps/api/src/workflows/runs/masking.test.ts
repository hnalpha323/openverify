/**
 * K8-13 (Workflow 8D review): what a run reader without PII visibility is shown when the masking has
 * nothing to go on (C120.6, fail closed). A step whose action the registry does not hold, a control
 * node with no plain members, inputs and variables of a version that is gone, and a trigger snapshot
 * that names no type each read as all `null`, keys kept. Pure; every value is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';
import {
  maskInputs,
  maskOutputs,
  maskStepOutput,
  maskTriggerSnapshot,
  maskVariables,
} from './masking.js';

const VALUES = { note: 'a synthetic note', count: 3, ok: true };
const ALL_NULL = { note: null, count: null, ok: null };

describe('masking with nothing to go on (C120.6)', () => {
  it('masks every output of a step whose action is unknown, or names none', () => {
    const unknown = { nodeType: 'action', actionKey: 'no_such_action', actionVersion: 1 } as const;
    const unnamed = { nodeType: 'action', actionKey: null, actionVersion: null } as const;

    expect(maskStepOutput(unknown, VALUES, WORKFLOW_ACTIONS)).toEqual(ALL_NULL);
    expect(maskStepOutput(unnamed, VALUES, WORKFLOW_ACTIONS)).toEqual(ALL_NULL);
  });

  it('masks every output of a control node that declares no plain member', () => {
    const step = { nodeType: 'output', actionKey: null, actionVersion: null } as const;

    expect(maskStepOutput(step, VALUES, WORKFLOW_ACTIONS)).toEqual(ALL_NULL);
  });

  it('masks inputs, variables and outputs whole when the definition is gone', () => {
    expect(maskInputs(VALUES, null)).toEqual(ALL_NULL);
    expect(maskVariables(VALUES, null)).toEqual(ALL_NULL);
    expect(maskOutputs(VALUES, null)).toEqual(ALL_NULL);
  });

  it('masks a trigger snapshot that names no type, or one no view knows', () => {
    expect(maskTriggerSnapshot(VALUES)).toEqual(ALL_NULL);
    expect(maskTriggerSnapshot({ ...VALUES, type: 'no-such-type' })).toEqual({
      ...ALL_NULL,
      type: null,
    });
  });
});
