/**
 * Phase 10, Workflow 10C Stage 1a (contracts-10c), family (N): NFC on the flow API. The
 * client-unable report (C207.9) and the sandbox test chip (C208.1) with their golden answers, the
 * nfc client view's three members on the session with the web-client golden that holds no
 * `prefillMrz` (C207.2, C221.1), the three problems beside the Phase 5 ones (C221.6), the
 * `flow-sandbox-chip` policy (C221.7) and the acknowledgement kind `client-unable` (C207.9).
 */
import { describe, expect, it } from 'vitest';
import { flowChipChallengeResponseSchema } from './chip-challenges.js';
import { flowSessionResponseSchema } from './flow-api.js';
import {
  CLIENT_UNABLE_REASONS,
  flowClientUnableBodySchema,
  flowClientUnableResponseSchema,
  flowSandboxChipBodySchema,
  flowSandboxChipResponseSchema,
  NFC_PREFILL_MRZ_MEMBER,
  SANDBOX_CHIP_DEFAULT_SCENARIO,
  SANDBOX_CHIP_RETURNED_FILE_KINDS,
  SANDBOX_CHIP_SCENARIOS,
} from './flow-nfc.js';
import {
  TEMPLATE_ACKNOWLEDGEMENT_KINDS,
  templateAcknowledgementKeySchema,
} from './inquiry-template-versions.js';
import { PHASE10_FLOW_PROBLEM_STATUSES, problemSchema } from './problem.js';
import {
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_POLICY_WINDOWS,
} from './rate-limits.js';
import { readFixture } from './test-support.js';

type Json = Record<string, unknown>;

describe('client-unable (C207.9)', () => {
  it('names the five self-reported reasons, read_failed for a read that was tried and did not finish', () => {
    expect(CLIENT_UNABLE_REASONS).toEqual([
      'nfc_unavailable',
      'reader_not_installed',
      'nfc_disabled_declined',
      'platform_unsupported',
      'read_failed',
    ]);
  });

  it('takes a reason and nothing else', () => {
    for (const reason of CLIENT_UNABLE_REASONS) {
      expect(flowClientUnableBodySchema.parse({ reason })).toEqual({ reason });
    }
    for (const refused of [{}, { reason: 'no_nfc' }, { reason: 'nfc_unavailable', note: 'x' }]) {
      expect(flowClientUnableBodySchema.safeParse(refused).success, JSON.stringify(refused)).toBe(
        false,
      );
    }
  });

  it('answers the verification, ended without passing', () => {
    const raw = readFixture('api/flow-client-unable.json');
    expect(flowClientUnableResponseSchema.parse(raw)).toEqual(raw);
    expect(raw).toMatchObject({ status: 'canceled' });
    expect(
      flowClientUnableResponseSchema.safeParse({ ...(raw as Json), status: 'passed' }).success,
    ).toBe(false);
  });
});

describe('the sandbox test chip (C208.1)', () => {
  const challenge = 'chc_01M5CK3190XEVBM5ZXA76E1JSM';

  it('names the five scenarios, match by default', () => {
    expect(SANDBOX_CHIP_SCENARIOS).toEqual([
      'match',
      'mrz-mismatch',
      'face-mismatch',
      'no-active-authentication',
      'tampered-dg1',
    ]);
    expect(SANDBOX_CHIP_DEFAULT_SCENARIO).toBe('match');
    expect(flowSandboxChipBodySchema.parse({ 'challenge-id': challenge })).toEqual({
      'challenge-id': challenge,
      scenario: 'match',
    });
  });

  it('takes a chip challenge id and a scenario, and nothing else', () => {
    for (const scenario of SANDBOX_CHIP_SCENARIOS) {
      const body = { 'challenge-id': challenge, scenario };
      expect(flowSandboxChipBodySchema.parse(body)).toEqual(body);
    }
    for (const refused of [
      {},
      { 'challenge-id': 'ich_01M5CK3190XEVBM5ZXA76E1JSM' },
      { 'challenge-id': challenge, scenario: 'revoked' },
      { 'challenge-id': challenge, nonce: '0123456789abcdef' },
    ]) {
      expect(flowSandboxChipBodySchema.safeParse(refused).success, JSON.stringify(refused)).toBe(
        false,
      );
    }
  });

  it('returns every chip file but DG2, which the server attaches itself', () => {
    expect(SANDBOX_CHIP_RETURNED_FILE_KINDS).toEqual([
      'chip-sod',
      'chip-dg1',
      'chip-dg14',
      'chip-dg15',
      'chip-card-security',
      'chip-card-access',
      'chip-com',
    ]);
    const raw = readFixture('api/flow-sandbox-chip.json') as Json;
    expect(flowSandboxChipResponseSchema.parse(raw)).toEqual(raw);
    expect(raw['dg2-attached']).toBe(true);
    const files = raw.files as { kind: string; content: string }[];
    expect(files.map((file) => file.kind)).not.toContain('chip-dg2');
    for (const refused of [
      { ...raw, 'dg2-attached': false },
      { ...raw, files: [...files, { kind: 'chip-dg2', content: 'c3ludGhldGlj' }] },
      { ...raw, files: [...files, { kind: 'chip-portrait', content: 'c3ludGhldGlj' }] },
      { ...raw, files: [{ kind: 'chip-sod', content: 'not base64!' }] },
      { ...raw, files: [] },
      { ...raw, 'active-authentication-response': 'A'.repeat(1372) },
    ]) {
      expect(flowSandboxChipResponseSchema.safeParse(refused).success).toBe(false);
    }
    const withoutResponse = Object.fromEntries(
      Object.entries(raw).filter(([member]) => member !== 'active-authentication-response'),
    );
    expect(flowSandboxChipResponseSchema.safeParse(withoutResponse).success).toBe(true);
  });
});

describe('the chip challenge and the nfc session goldens (C207.1, C207.2, C221.1)', () => {
  it('holds a golden chip challenge', () => {
    const raw = readFixture('api/flow-chip-challenge.json');
    expect(flowChipChallengeResponseSchema.parse(raw)).toEqual(raw);
  });

  it('serves a web client at an nfc step no prefillMrz and no sandbox chip', () => {
    const raw = readFixture('api/flow-session-nfc.json') as Json;
    expect(flowSessionResponseSchema.parse(raw)).toEqual(raw);
    expect(raw.step).toEqual({
      id: 'chip',
      type: 'nfc',
      androidOnly: true,
      maxAttempts: 3,
      fallbackAvailable: true,
    });
    expect(JSON.stringify(raw)).not.toContain(NFC_PREFILL_MRZ_MEMBER);
  });

  it('serves an SDK client at the nfc step the three members', () => {
    const raw = readFixture('api/flow-session-nfc-sdk.json') as Json;
    expect(flowSessionResponseSchema.parse(raw)).toEqual(raw);
    expect(raw.step).toMatchObject({
      fallbackAvailable: true,
      sandboxChipAvailable: true,
      prefillMrz: { documentNumber: 'L898902C3', birthDate: '740812', expiryDate: '120415' },
    });
    expect(NFC_PREFILL_MRZ_MEMBER).toBe('prefillMrz');
  });
});

describe('the 10C problems of the flow API (C221.6)', () => {
  const golden: [string, number, string][] = [
    ['client_unable_not_allowed', 409, 'Conflict'],
    ['sandbox_chip_anchor_missing', 409, 'Conflict'],
    ['sandbox_chip_scenario_unavailable', 422, 'Unprocessable Content'],
  ];

  it('freezes them with 10B’s integrity_challenge_invalid', () => {
    expect(PHASE10_FLOW_PROBLEM_STATUSES).toEqual({
      integrity_challenge_invalid: 409,
      client_unable_not_allowed: 409,
      sandbox_chip_anchor_missing: 409,
      sandbox_chip_scenario_unavailable: 422,
    });
  });

  it.each(golden)('has the golden problem of %s (%d)', (code, status, title) => {
    const raw = readFixture(`problems/flow/${code.replaceAll('_', '-')}.json`);
    const problem = problemSchema.parse(raw);
    expect(problem).toEqual(raw);
    expect(problem).toMatchObject({ type: 'about:blank', title, status, code });
    // Rule 10: the person is never told that the fallback goes to review.
    expect(JSON.stringify(raw)).not.toMatch(/review/i);
  });
});

describe('the flow-sandbox-chip policy (C221.7)', () => {
  it('is 10 an hour, per inquiry, in all three maps', () => {
    // Workflow 11A added two policies after it (C240.3), so it is held by name, not by position.
    expect(RATE_LIMIT_POLICIES).toContain('flow-sandbox-chip');
    expect((RATE_LIMIT_DEFAULTS as Record<string, number>)['flow-sandbox-chip']).toBe(10);
    expect((RATE_LIMIT_POLICY_WINDOWS as Record<string, number>)['flow-sandbox-chip']).toBe(3600);
  });
});

describe('the client-unable acknowledgement (C207.9; C150.6 and C154.9 amended)', () => {
  it('is a template acknowledgement kind, keyed by the nfc step', () => {
    expect(TEMPLATE_ACKNOWLEDGEMENT_KINDS).toContain('client-unable');
    expect(templateAcknowledgementKeySchema.safeParse('client-unable:chip').success).toBe(true);
  });
});
