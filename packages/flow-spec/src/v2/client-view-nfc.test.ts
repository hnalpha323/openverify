/**
 * Phase 10, Workflow 10C Stage 1a (contracts-10c): the `nfc` step's client view (C207.1, C207.9,
 * C208.2, C221.1; review F26). `fallbackAvailable` is a pure fact of the flow, filled by
 * `clientViewOf`; `sandboxChipAvailable` and `prefillMrz` need the inquiry and the environment and
 * come from the API's session builder. The v1 `nfcStepSchema`, which validates flows, takes none.
 */
import { describe, expect, it } from 'vitest';
import { nfcStepSchema } from '../flow.js';
import { ACKNOWLEDGEMENT_KINDS } from './analyses.js';
import { clientViewOf } from './client-view.js';
import { CLIENT_UNABLE_NOTE_PREFIXES, FLOW_STEP_NOTES, flowOutcome } from './next-position.js';
import {
  clientStepViewSchema,
  nfcClientViewSchema,
  nfcPrefillMrzSchema,
} from './schemas/client-view.js';
import { stepV2Schema, type FlowV2Step } from './schemas/steps.js';
import { nfc } from './test-flows.js';

const step = (raw: Record<string, unknown>): FlowV2Step => stepV2Schema.parse(raw);
const edge = (from: string, port: string, to: string) => ({ from, port, to });

// ICAO Doc 9303's specimen key fields: synthetic.
const prefill = { documentNumber: 'L898902C3', birthDate: '740812', expiryDate: '120415' };

describe('the nfc client view (C207.1, C221.1)', () => {
  it('takes the three new members, each optional, and nothing else', () => {
    const view = { id: 'chip', type: 'nfc', androidOnly: true, maxAttempts: 3 };
    expect(nfcClientViewSchema.parse(view)).toEqual(view);
    const full = {
      ...view,
      fallbackAvailable: true,
      sandboxChipAvailable: true,
      prefillMrz: prefill,
    };
    expect(nfcClientViewSchema.parse(full)).toEqual(full);
    expect(clientStepViewSchema.parse(full)).toEqual(full);
    expect(nfcClientViewSchema.safeParse({ ...view, onFallback: 'review' }).success).toBe(false);
    expect(nfcClientViewSchema.safeParse({ ...view, fallbackAvailable: 'yes' }).success).toBe(
      false,
    );
  });

  it('leaves the v1 step schema, which validates flows, without them', () => {
    const view = { id: 'chip', type: 'nfc', androidOnly: true };
    for (const member of [
      { fallbackAvailable: true },
      { sandboxChipAvailable: true },
      { prefillMrz: prefill },
    ]) {
      expect(nfcStepSchema.safeParse({ ...view, ...member }).success, JSON.stringify(member)).toBe(
        false,
      );
    }
  });

  it('holds prefillMrz to the MRZ’s key fields and marks it PII', () => {
    expect(nfcPrefillMrzSchema.parse(prefill)).toEqual(prefill);
    expect(nfcPrefillMrzSchema.meta()).toMatchObject({ pii: true });
    for (const refused of [
      { ...prefill, documentNumber: '' },
      { ...prefill, documentNumber: 'l898902c3' },
      { ...prefill, birthDate: '1974-08-12' },
      { ...prefill, expiryDate: '12041' },
      { ...prefill, name: 'ANNA MARIA' },
      { documentNumber: 'L898902C3', birthDate: '740812' },
    ]) {
      expect(nfcPrefillMrzSchema.safeParse(refused).success, JSON.stringify(refused)).toBe(false);
    }
    // An unknown birth date keeps the MRZ's fillers (ICAO Doc 9303 Part 3, 4.8).
    expect(nfcPrefillMrzSchema.safeParse({ ...prefill, birthDate: '74<<<<' }).success).toBe(true);
  });
});

describe('clientViewOf at an nfc step (review F26)', () => {
  const chip = step(nfc('chip', { onFallback: 'continue' }));

  it('says whether the step has an exhausted edge, from the flow alone', () => {
    expect(clientViewOf(chip, { edges: [edge('chip', 'exhausted', 'manual')] })).toEqual({
      id: 'chip',
      type: 'nfc',
      androidOnly: true,
      fallbackAvailable: true,
    });
    for (const edges of [
      [],
      [edge('chip', 'next', 'done')],
      [edge('id_card', 'exhausted', 'manual')],
    ]) {
      expect(clientViewOf(chip, { edges })).toMatchObject({ fallbackAvailable: false });
    }
  });

  it('never sends onFallback, and answers a valid client view', () => {
    const view = clientViewOf(chip, { edges: [edge('chip', 'exhausted', 'manual')] });
    expect(JSON.stringify(view)).not.toContain('onFallback');
    expect(clientStepViewSchema.parse(view)).toEqual(view);
  });

  it('leaves the member out when no flow is given, and never adds it to another step type', () => {
    expect(clientViewOf(chip)).toEqual({ id: 'chip', type: 'nfc', androidOnly: true });
    const done = step({ id: 'done', type: 'completion' });
    expect(clientViewOf(done, { edges: [edge('done', 'exhausted', 'x')] })).toEqual({
      id: 'done',
      type: 'completion',
    });
  });
});

describe('client-unable in the publish analyses and the step record (C207.9)', () => {
  it('is an acknowledgement kind of its own, after the Phase 9 kinds', () => {
    expect(ACKNOWLEDGEMENT_KINDS).toEqual([
      'fallback',
      'heuristic',
      'adverse-path',
      'asserted-fact',
      'unverified-path',
      'client-unable',
    ]);
  });

  it('has its step-record note codes: the report, its reason and the platform', () => {
    expect(FLOW_STEP_NOTES.clientUnable).toBe('client-unable');
    expect(CLIENT_UNABLE_NOTE_PREFIXES).toEqual({
      reason: 'client-unable-reason:',
      platform: 'client-unable-platform:',
    });
  });

  it('reads a client-unable exit as any fallback: review unless the exit carries fallback-continue', () => {
    // C207.9: the engine's settlement hook reads a step left by a client-unable report as decided
    // without passing; `flowOutcome`'s own fallback rule then sends the inquiry to review, and
    // api-nfc writes `fallback-continue` only for a version that carries `client-unable:<step id>`.
    const entry = (notes: string[]) => [
      { stepId: 'chip', stepType: 'nfc', exitPort: 'exhausted', notes },
      { stepId: 'done', stepType: 'completion', exitPort: null, notes: [] },
    ];
    const reported = ['client-unable', 'client-unable-reason:nfc_unavailable'];
    expect(flowOutcome(entry(reported), { chip: 'failed' }, []).status).toBe('needs_review');
    expect(
      flowOutcome(entry([...reported, FLOW_STEP_NOTES.fallbackContinue]), { chip: 'failed' }, [])
        .status,
    ).toBe('completed');
    // A canceled attempt alone is not a decided step: the hook's reading is what settles it.
    expect(flowOutcome(entry(reported), { chip: 'pending' }, []).status).toBe('pending');
  });
});
