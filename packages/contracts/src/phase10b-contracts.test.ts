/**
 * Phase 10, Workflow 10B Stage 1a (contracts-10b): the common contracts. The integrity challenge's
 * identifier `ich` (C221.2) in both prefix tables; the flow API's `integrity_challenge_invalid` (409)
 * with its golden problem beside the Phase 5 ones (C221.6); the publish rule codes of the device-
 * integrity signals (C210.5, C211.9), carried in a `definition_invalid`'s `errors[]`, with their golden.
 */
import { describe, expect, it } from 'vitest';
import { buildFileResource, fileAttributesSchema } from './files.js';
import { flowFileUploadFieldsSchema } from './flow-api.js';
import { ID_PREFIXES } from './ids.js';
import {
  PHASE10_FLOW_PROBLEM_STATUSES,
  problemSchema,
  SIGNAL_PUBLISH_RULE_CODES,
} from './problem.js';
import { readFixture } from './test-support.js';

describe('the integrity challenge identifier (C221.2)', () => {
  it('is ich, once (packages/db/src/ids.test.ts holds the database table to the same)', () => {
    expect(ID_PREFIXES).toHaveProperty('integrityChallenge', 'ich');
    expect(Object.values(ID_PREFIXES).filter((prefix) => prefix === 'ich')).toHaveLength(1);
  });
});

describe('the Phase 10 problems (C221.6)', () => {
  it('freezes integrity_challenge_invalid as a 409 of the flow API', () => {
    // Workflow 10C (C221.6) adds its three codes beside it (phase10c-contracts.test.ts).
    expect(PHASE10_FLOW_PROBLEM_STATUSES).toMatchObject({ integrity_challenge_invalid: 409 });
    expect(Object.isFrozen(PHASE10_FLOW_PROBLEM_STATUSES)).toBe(true);
  });

  it('has its golden problem, naming no challenge, token or verdict', () => {
    const raw = readFixture('problems/flow/integrity-challenge-invalid.json');
    const problem = problemSchema.parse(raw);
    expect(problem).toEqual(raw);
    expect(problem).toMatchObject({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'integrity_challenge_invalid',
    });
    expect(problem.detail).not.toMatch(/ich_|sandbox-|token/i);
  });

  it('names the two publish rule codes of the device-integrity signals', () => {
    expect(SIGNAL_PUBLISH_RULE_CODES).toEqual([
      'signal_not_decisive_alone',
      'play_integrity_notice_missing',
    ]);
    expect(Object.isFrozen(SIGNAL_PUBLISH_RULE_CODES)).toBe(true);
  });

  it('carries both in the golden definition_invalid of a flow', () => {
    const problem = problemSchema.parse(
      readFixture('problems/templates/definition-invalid-integrity.json'),
    );
    expect(problem).toMatchObject({ status: 422, code: 'definition_invalid' });
    expect(
      (problem as { errors?: { code?: string }[] }).errors?.map((error) => error.code),
    ).toEqual([...SIGNAL_PUBLISH_RULE_CODES]);
  });
});

describe("the upload's capture-trigger and the file's client-reported attributes (C206)", () => {
  it('takes capture-trigger auto or manual beside capture-method, both optional', () => {
    expect(
      flowFileUploadFieldsSchema.parse({
        kind: 'front',
        'capture-method': 'camera',
        'capture-trigger': 'auto',
      }),
    ).toEqual({
      kind: 'front',
      'capture-method': 'camera',
      'capture-trigger': 'auto',
    });
    expect(
      flowFileUploadFieldsSchema.safeParse({ kind: 'front', 'capture-trigger': 'manual' }).success,
    ).toBe(true);
    expect(flowFileUploadFieldsSchema.safeParse({ kind: 'front' }).success).toBe(true);
    expect(
      flowFileUploadFieldsSchema.safeParse({ kind: 'front', 'capture-trigger': 'timer' }).success,
    ).toBe(false);
  });

  it('serves capture-method and capture-trigger on the file, each null when the client sent none', () => {
    const record = {
      id: 'file_01M5CK3288G5K9T8DC51K68DDZ',
      kind: 'front' as const,
      mimeType: 'image/jpeg' as const,
      byteSize: 1024,
      createdAt: new Date('2026-11-09T12:00:00.000Z'),
      verification: { id: 'ver_01M5CK3190XEVBM5ZXA76E1JSM', type: 'government_id' as const },
    };
    expect(
      buildFileResource({ ...record, captureMethod: null, captureTrigger: null }).attributes,
    ).toMatchObject({ 'capture-method': null, 'capture-trigger': null });
    // The flow's upload answer passes neither (C40.10), so neither is in it.
    expect(buildFileResource(record).attributes).not.toHaveProperty('capture-method');
    expect(
      buildFileResource({ ...record, captureMethod: 'camera', captureTrigger: 'auto' }).attributes,
    ).toMatchObject({ 'capture-method': 'camera', 'capture-trigger': 'auto' });
    // Optional on read (a file stored before Workflow 10B, a client that parses older answers); the API always serves both.
    expect(
      fileAttributesSchema.safeParse({
        kind: 'front',
        'mime-type': 'image/jpeg',
        'byte-size': 1,
        'created-at': '2026-11-09T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
