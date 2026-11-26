import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ID_PREFIXES,
  MAX_ULID_TIME,
  ULID_PATTERN,
  anyIdSchema,
  idSchema,
  isId,
  isIdPrefix,
  newId,
  ulid,
  ulidTime,
  type IdPrefix,
} from './ids.js';

/** Fixed randomness source for deterministic ULIDs. */
const bytes =
  (...values: number[]) =>
  (length: number): Uint8Array => {
    expect(length).toBe(10);
    return Uint8Array.from(values);
  };
const zeros = bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

describe('ID_PREFIXES', () => {
  it('maps every C1 object to its prefix', () => {
    expect(ID_PREFIXES).toEqual({
      organization: 'org',
      environment: 'env',
      apiKey: 'key',
      user: 'usr',
      userSession: 'uss',
      inquiryTemplate: 'itmpl',
      inquiryTemplateVersion: 'itmplv',
      inquiry: 'inq',
      inquirySession: 'iqse',
      verification: 'ver',
      file: 'file',
      event: 'evt',
      webhook: 'wbh',
      webhookDelivery: 'whd',
      account: 'acc',
      accountType: 'acctp',
      role: 'role',
      userAuditLog: 'aud',
      apiLog: 'alog',
      mfaFactor: 'mfa',
      selfieCapture: 'self',
      // Phase 5 (C53.2, C53.3).
      otpChallenge: 'otpc',
      cryptoChallenge: 'cwc',
      chipChallenge: 'chc',
      // Phase 6 (C70.1): reports, their templates and versions, runs, actions and matches.
      report: 'rep',
      reportTemplate: 'rptp',
      reportTemplateVersion: 'rptpv',
      reportRun: 'rpr',
      reportAction: 'ract',
      reportMatch: 'rpm',
      // Phase 7 (C91.2, C91.3): devices and networks.
      device: 'dev',
      network: 'net',
      // C96.3: a handoff token's row, never the token.
      handoff: 'hnd',
      // Workflow 7B (C97.1, C99.3, C100.1).
      list: 'lst',
      listItemBrowserFingerprint: 'libf',
      listItemDeviceFingerprint: 'lidf',
      listItemCountry: 'lic',
      listItemEmailAddress: 'liea',
      listItemFace: 'lifc',
      listItemGeolocation: 'ligl',
      listItemGovernmentIdNumber: 'ligin',
      listItemField: 'liif',
      listItemIpAddress: 'liip',
      listItemName: 'lin',
      listItemPhoneNumber: 'lipn',
      listItemSelfieBackground: 'lisb',
      listItemString: 'lis',
      listMatch: 'lmt',
      importer: 'mprt',
      // Workflow 7B (C104.1, C105).
      transaction: 'txn',
      transactionType: 'txntp',
      transactionTypeVersion: 'txntpv',
      transactionLabel: 'txnl',
      transactionFile: 'txnf',
      // Workflow 7B (C102).
      graphQuery: 'grphq',
      graphQueryTemplate: 'grqt',
      graphQueryTemplateVersion: 'grqtv',
      // C112.1: public where public; the step, delivery, schedule, effect and file rows are
      // internal, served only inside a run's step list; `idec` is a served decision record.
      workflow: 'wfl',
      workflowVersion: 'wfv',
      workflowDeployment: 'wfd',
      workflowRun: 'wfr',
      scheduledRun: 'srrun',
      accountAction: 'accac',
      workflowSecret: 'wsec',
      workflowSecretValue: 'wsecv',
      workflowRunStep: 'wfst',
      workflowTriggerDelivery: 'wftd',
      workflowSchedule: 'wfsc',
      workflowEffect: 'wfef',
      workflowRunFile: 'wfrf',
      inquiryDecision: 'idec',
      // Workflow 8B (C129.1): the public prefixes, ours beside them, and the bulk action and the
      // notification, which C129.1 does not name (Stage 1a amendment 5).
      case: 'case',
      caseTemplate: 'ctmpl',
      caseTemplateVersion: 'ctmplv',
      caseQueue: 'cqueue',
      caseComment: 'cscm',
      caseAssignmentPolicy: 'cap',
      caseAttachment: 'catt',
      caseAction: 'cact',
      caseSlaPolicy: 'cslap',
      caseCalendar: 'ccal',
      caseExport: 'cexp',
      caseBulkAction: 'cblk',
      userNotification: 'unot',
      // Workflow 9A (C174.1): the public theme set and deployment, then ours.
      themeSet: 'theset',
      deployment: 'dply',
      themeAsset: 'tsa',
      simulationPreset: 'ssp',
      // Workflow 9B (C174.1): ours, an export, a saved view and a bulk report job.
      export: 'exp',
      savedView: 'svw',
      reportBulkJob: 'rbulk',
      integrityChallenge: 'ich',
      // Workflow 11A (C230.1): the two public Connect prefixes, then ours.
      connection: 'cxn',
      shareToken: 'cnst',
      sharePolicy: 'cxnp',
      consentRecord: 'cnsr',
      // Workflow 11B (C253.1): ours, an account's access export.
      accountExport: 'aexp',
      // Workflow 11B (C248.3): ours, an SSO provider.
      ssoProvider: 'ssop',
    });
  });

  it('holds the Workflow 9B prefixes (C174.1): exports, saved views and bulk report jobs, all ours', () => {
    expect(ID_PREFIXES).toMatchObject({ export: 'exp', savedView: 'svw', reportBulkJob: 'rbulk' });
    expect(isIdPrefix('exp')).toBe(true);
    expect(isIdPrefix('svw')).toBe(true);
    expect(isIdPrefix('rbulk')).toBe(true);
  });

  it('holds the Workflow 9A prefixes (C174.1): theme sets and deployments public, assets and presets ours', () => {
    expect(ID_PREFIXES).toMatchObject({
      themeSet: 'theset',
      deployment: 'dply',
      themeAsset: 'tsa',
      simulationPreset: 'ssp',
    });
    expect(isIdPrefix('theset')).toBe(true);
    expect(isIdPrefix('dply')).toBe(true);
    expect(isIdPrefix('tsa')).toBe(true);
    expect(isIdPrefix('ssp')).toBe(true);
  });

  it('uses distinct, lowercase prefixes', () => {
    const prefixes = Object.values(ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const prefix of prefixes) {
      expect(prefix).toMatch(/^[a-z]+$/);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ID_PREFIXES)).toBe(true);
  });

  it('recognises prefixes by own property only', () => {
    expect(isIdPrefix('inq')).toBe(true);
    expect(isIdPrefix('itmplv')).toBe(true);
    expect(isIdPrefix('inquiry')).toBe(false);
    expect(isIdPrefix('toString')).toBe(false);
    expect(isIdPrefix('constructor')).toBe(false);
    expect(isIdPrefix(42)).toBe(false);
  });
});

describe('ulid', () => {
  // Reference values computed independently with a Python Crockford base32 encoder.
  it.each([
    ['ULID spec timestamp', 1469918176385, zeros, '01ARYZ6S410000000000000000'],
    ['zero', 0, zeros, '00000000000000000000000000'],
    [
      'maximum',
      MAX_ULID_TIME,
      bytes(255, 255, 255, 255, 255, 255, 255, 255, 255, 255),
      '7ZZZZZZZZZZZZZZZZZZZZZZZZZ',
    ],
    ['sequence', 1792497600000, bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), '01M5CJXHG0041061050R3GG28A'],
    [
      'mixed',
      1792497600123,
      bytes(0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55),
      '01M5CJXHKVVTPVXVR024H36H2N',
    ],
  ])('encodes the %s vector', (_name, now, random, expected) => {
    expect(ulid({ now, random })).toBe(expected);
  });

  it('accepts a Date for the time component', () => {
    expect(ulid({ now: new Date(1792497600000), random: zeros })).toBe(
      '01M5CJXHG00000000000000000',
    );
  });

  it('uses the current time and Web Crypto randomness by default', () => {
    const before = Date.now();
    const first = ulid();
    const second = ulid();
    const after = Date.now();

    expect(first).toMatch(ULID_PATTERN);
    expect(second).toMatch(ULID_PATTERN);
    expect(first).not.toBe(second);
    expect(ulidTime(first)).toBeGreaterThanOrEqual(before);
    expect(ulidTime(first)).toBeLessThanOrEqual(after);
  });

  it('sorts lexicographically by creation time', () => {
    const earlier = ulid({
      now: 1792497600000,
      random: bytes(255, 255, 255, 255, 255, 255, 255, 255, 255, 255),
    });
    const later = ulid({ now: 1792497600001, random: zeros });
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['beyond 48 bits', MAX_ULID_TIME + 1],
    ['NaN', Number.NaN],
    ['an invalid date', new Date(Number.NaN)],
  ])('rejects a %s time', (_name, now) => {
    expect(() => ulid({ now, random: zeros })).toThrow(RangeError);
  });

  it('rejects a randomness source that returns the wrong number of bytes', () => {
    expect(() => ulid({ now: 0, random: () => new Uint8Array(9) })).toThrow(TypeError);
  });
});

describe('ulidTime', () => {
  it('decodes the time component', () => {
    expect(ulidTime('01ARYZ6S410000000000000000')).toBe(1469918176385);
    expect(ulidTime('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe(MAX_ULID_TIME);
  });

  it.each([
    '',
    '01ARYZ6S41',
    '01arYZ6S410000000000000000',
    '81ARYZ6S410000000000000000',
    '01ARYZ6S41000000000000000U',
  ])('rejects %j', (value) => {
    expect(() => ulidTime(value)).toThrow(TypeError);
  });
});

describe('newId', () => {
  it('prefixes a fresh ULID', () => {
    const id = newId('inq');
    expect(id).toMatch(/^inq_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(isId('inq', id)).toBe(true);
  });

  it('passes ULID options through', () => {
    expect(newId('evt', { now: 1792497600000, random: bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10) })).toBe(
      'evt_01M5CJXHG0041061050R3GG28A',
    );
  });

  it('rejects unknown prefixes at runtime', () => {
    expect(() => newId('nope' as IdPrefix)).toThrow(TypeError);
  });
});

describe('isId', () => {
  const id = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';

  it('accepts a well-formed id for the prefix', () => {
    expect(isId('inq', id)).toBe(true);
  });

  it.each([
    ['another prefix', 'ver', id],
    ['a longer prefix sharing the start', 'itmpl', 'itmplv_01M5A0GTG0VF5QW51511984D0G'],
    ['the account type prefix for an account', 'acc', 'acctp_01M5A0GTG0VF5QW51511984D0G'],
    ['no separator', 'inq', 'inq01M5CJXHG07XPHF3HRM6NREDH7'],
    ['lowercase ULID', 'inq', 'inq_01m5cjxhg07xphf3hrm6nredh7'],
    ['excluded letter U', 'inq', 'inq_01M5CJXHG07XPHF3HRM6NREDHU'],
    ['ULID overflow', 'inq', 'inq_81M5CJXHG07XPHF3HRM6NREDH7'],
    ['short ULID', 'inq', 'inq_01M5CJXHG07XPHF3HRM6NRED'],
    ['trailing newline', 'inq', `${id}\n`],
    ['a UUID', 'inq', 'inq_5f0c6a52-1b7e-4f43-9d2a-3c1f0e9b8a71'],
    ['a non-string', 'inq', 42],
  ] as const)('rejects %s', (_name, prefix, value) => {
    expect(isId(prefix, value)).toBe(false);
  });

  it('returns false for unknown prefixes', () => {
    expect(isId('nope' as IdPrefix, 'nope_01M5CJXHG07XPHF3HRM6NREDH7')).toBe(false);
  });
});

describe('idSchema', () => {
  it('validates ids of one prefix', () => {
    const schema = idSchema('ver');
    expect(schema.parse('ver_01M5CK16P0D13FXHZSS4TCFBVH')).toBe('ver_01M5CK16P0D13FXHZSS4TCFBVH');
    expect(schema.safeParse('inq_01M5CJXHG07XPHF3HRM6NREDH7').success).toBe(false);
    expect(schema.safeParse(1).success).toBe(false);
  });

  it('converts to a JSON Schema pattern', () => {
    expect(z.toJSONSchema(idSchema('itmpl'))).toMatchObject({
      type: 'string',
      pattern: '^itmpl_[0-7][0-9A-HJKMNP-TV-Z]{25}$',
    });
  });

  it('rejects unknown prefixes', () => {
    expect(() => idSchema('nope' as IdPrefix)).toThrow(TypeError);
  });
});

describe('anyIdSchema', () => {
  it.each([
    'inq_01M5CJXHG07XPHF3HRM6NREDH7',
    'acc_01M5CJXHG07XPHF3HRM6NREDH7',
    'acctp_01M5CJXHG07XPHF3HRM6NREDH7',
    'alog_01M5CJXHG07XPHF3HRM6NREDH7',
    'mfa_01M5CJXHG07XPHF3HRM6NREDH7',
  ])('accepts %s', (value) => {
    expect(anyIdSchema.parse(value)).toBe(value);
  });

  it.each(['nope_01M5CJXHG07XPHF3HRM6NREDH7', 'inq_01m5cjxhg07xphf3hrm6nredh7', 'inq_', 42])(
    'rejects %j',
    (value) => {
      expect(anyIdSchema.safeParse(value).success).toBe(false);
    },
  );
});
