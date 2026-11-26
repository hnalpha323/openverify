import {
  buildInquiryResource,
  buildInquirySessionResource,
  buildVerificationResource,
  toVerificationResourceType,
} from '@openverify/contracts';
import { VERIFICATION_TYPES } from '@openverify/core';
import type { Inquiry, InquirySession, VerificationWithChecks } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import {
  inquiryRecordOf,
  inquirySessionRecordOf,
  inquirySessionStatusAt,
  verificationRecordOf,
} from './records.js';

const at = new Date('2026-10-20T12:00:00.000Z');
const INQUIRY = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';

function verificationRow(overrides: Partial<VerificationWithChecks> = {}): VerificationWithChecks {
  return {
    id: 'ver_01M5CJZC301G4JHXZQ3PZBYH3Q',
    environmentId: 'env_01M5CJXHG0000000000000000A',
    inquiryId: INQUIRY,
    type: 'government_id',
    status: 'failed',
    country: 'US',
    idClass: 'drivers_license',
    submittedAt: at,
    completedAt: at,
    // C40.7 (Phase 4).
    selfieCaptureRequired: true,
    // Workflow 7A (V02): created by no flow session, and not from a rejected handoff.
    createdBySessionId: null,
    fromRejectedHandoff: false,
    workflowRunStepId: null,
    // Workflow 11A (C230.5): not a clone.
    provenance: null,
    // Workflow 11B Stage 1b (P) (C251.1): its job's admission stamp.
    admittedAt: null,
    createdAt: at,
    updatedAt: at,
    checks: [
      {
        environmentId: 'env_01M5CJXHG0000000000000000A',
        verificationId: 'ver_01M5CJZC301G4JHXZQ3PZBYH3Q',
        name: 'id_blur_detection',
        status: 'failed',
        type: 'user_behavior',
        requirement: 'required',
        reasons: ['image_blurry'],
        metadata: { blurry_sides: ['front'] },
        stage: null,
        confidence: null,
        provenance: null,
        // Workflow 11A (C230.5): not a cloned check.
        connectProvenance: null,
        createdAt: at,
        updatedAt: at,
      },
      {
        environmentId: 'env_01M5CJXHG0000000000000000A',
        verificationId: 'ver_01M5CJZC301G4JHXZQ3PZBYH3Q',
        name: 'id_glare_detection',
        status: 'passed',
        type: 'user_behavior',
        requirement: 'not_required',
        reasons: [],
        metadata: {},
        stage: null,
        confidence: null,
        provenance: null,
        // Workflow 11A (C230.5): not a cloned check.
        connectProvenance: null,
        createdAt: at,
        updatedAt: at,
      },
    ],
    ...overrides,
  };
}

describe('verificationRecordOf', () => {
  it('carries from-rejected-handoff into the verification.* events (C96.3)', () => {
    const row = verificationRow({ fromRejectedHandoff: true, checks: [] });

    expect(verificationRecordOf(row, []).fromRejectedHandoff).toBe(true);
  });

  it('carries each stored check stage, confidence and provenance (C29.2)', () => {
    const provenance = { 'implementation-version': 1, thresholds: { 'min-blur-score': 100 } };
    const row = verificationRow();
    const [blur, glare] = row.checks;
    if (blur === undefined || glare === undefined) {
      throw new Error('fixture has two checks');
    }
    const record = verificationRecordOf(
      {
        ...row,
        checks: [
          { ...blur, stage: 'ga', confidence: 0.25, provenance },
          { ...glare, stage: null, confidence: null, provenance: null },
        ],
      },
      [],
    );
    expect(record.checks).toMatchObject([
      { stage: 'ga', confidence: 0.25, provenance },
      { stage: null, confidence: null, provenance: null },
    ]);
  });

  it('maps a stored verification and its checks to the contract record', () => {
    const record = verificationRecordOf(verificationRow(), ['file_01M5CJZD282YV9958CG7ZK9ZKN']);
    expect(record).toMatchObject({
      type: 'government_id',
      status: 'failed',
      inquiryId: INQUIRY,
      country: 'US',
      idClass: 'drivers_license',
      fileIds: ['file_01M5CJZD282YV9958CG7ZK9ZKN'],
      checks: [
        { name: 'id_blur_detection', required: true, reasons: ['image_blurry'] },
        { name: 'id_glare_detection', required: false },
      ],
    });
    expect(buildVerificationResource(record).attributes.checks).toEqual([
      expect.objectContaining({ name: 'id_blur_detection', requirement: 'required' }),
      expect.objectContaining({ name: 'id_glare_detection', requirement: 'not_required' }),
    ]);
  });

  // C50.6: no type is left out or refused; each is served as its own resource type.
  it.each(VERIFICATION_TYPES)('records a %s verification', (type) => {
    const record = verificationRecordOf(verificationRow({ type, checks: [] }), []);

    expect(record.type).toBe(type);
    expect(buildVerificationResource(record).type).toBe(toVerificationResourceType(type));
  });
});

/** C151.1 (Workflow 9A): an inquiry the flow engine has not positioned yet. */
const NO_FLOW_POSITION = {
  flowStepId: null,
  flowState: null,
  flowPreviousStepId: null,
  flowSpecVersion: null,
  firstDeviceKind: null,
  firstPlatform: null,
  flowOutcome: null,
  redirectUri: null,
  themeSetId: null,
  // C151.10 (Workflow 9B Stage 1b (F)): no window of its own, so the version decides.
  expirationAfterStartSeconds: null,
  expirationAfterResumeSeconds: null,
  oneTimeLinkExpirationSeconds: null,
} as const;

describe('inquiryRecordOf', () => {
  const inquiry: Inquiry = {
    id: INQUIRY,
    environmentId: 'env_01M5CJXHG0000000000000000A',
    inquiryTemplateId: 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
    inquiryTemplateVersionId: 'itmplv_01M5A0GTG0RSTVX9PHA0V7P3X6',
    status: 'completed',
    referenceId: 'ref-synthetic-1',
    fields: { name_first: 'Synthetic' },
    startedAt: at,
    completedAt: at,
    failedAt: null,
    expiredAt: null,
    decisionedAt: null,
    accountId: 'acc_01M5CJXHG07XPHF3HRM6NREDH8',
    tags: ['VIP'],
    note: 'Synthetic note',
    expiresAt: at,
    redactedAt: null,
    workflowRunStepId: null,
    signals: null,
    signalDetails: null,
    // Workflow 11A (C230.5): not a copy.
    provenance: null,
    hydratedFields: null,
    ...NO_FLOW_POSITION,
    createdAt: at,
    updatedAt: at,
  };

  it('maps the inquiry and lists its verifications of every type oldest first (C50.6)', () => {
    const record = inquiryRecordOf(inquiry, [
      verificationRow(),
      verificationRow({ id: 'ver_01M5CK3190XEVBM5ZXA76E1JSM', type: 'selfie' }),
      verificationRow({ id: 'ver_01M5CK3190XEVBM5ZXA76E1JSN', type: 'document' }),
    ]);
    expect(record.verifications).toEqual([
      { id: 'ver_01M5CJZC301G4JHXZQ3PZBYH3Q', type: 'government_id' },
      { id: 'ver_01M5CK3190XEVBM5ZXA76E1JSM', type: 'selfie' },
      { id: 'ver_01M5CK3190XEVBM5ZXA76E1JSN', type: 'document' },
    ]);
    expect(buildInquiryResource(record).attributes).toMatchObject({
      status: 'completed',
      'reference-id': 'ref-synthetic-1',
      fields: { name_first: 'Synthetic' },
    });
  });
});

describe('inquiryRecordOf (Phase 2 attributes)', () => {
  it('carries the tags, note, expiry, redaction, decision time and account (C10, C13)', () => {
    const inquiry = {
      id: INQUIRY,
      environmentId: 'env_01M5CJXHG0000000000000000A',
      inquiryTemplateId: 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
      inquiryTemplateVersionId: 'itmplv_01M5A0GTG0RSTVX9PHA0V7P3X6',
      status: 'approved',
      referenceId: null,
      fields: {},
      startedAt: at,
      completedAt: at,
      failedAt: null,
      expiredAt: null,
      decisionedAt: at,
      accountId: 'acc_01M5CJXHG07XPHF3HRM6NREDH8',
      tags: ['VIP', 'repeat'],
      note: 'Synthetic note',
      expiresAt: at,
      redactedAt: null,
      workflowRunStepId: null,
      signals: null,
      signalDetails: null,
      // Workflow 11A (C230.5): not a copy.
      provenance: null,
      hydratedFields: null,
      ...NO_FLOW_POSITION,
      createdAt: at,
      updatedAt: at,
    } satisfies Inquiry;

    const resource = buildInquiryResource(inquiryRecordOf(inquiry, []));

    expect(resource.attributes).toMatchObject({
      tags: ['VIP', 'repeat'],
      note: 'Synthetic note',
      'expires-at': at.toISOString(),
      'redacted-at': null,
      'decisioned-at': at.toISOString(),
    });
    expect(resource.relationships.account).toEqual({
      data: { type: 'account', id: 'acc_01M5CJXHG07XPHF3HRM6NREDH8' },
    });
  });
});

describe('inquirySessionRecordOf', () => {
  const later = new Date(at.getTime() + 60_000);
  const session = (overrides: Partial<InquirySession> = {}): InquirySession => ({
    id: 'iqse_01M5CJXHG07XPHF3HRM6NREDH9',
    environmentId: 'env_01M5CJXHG0000000000000000A',
    inquiryId: INQUIRY,
    tokenHash: 'a'.repeat(64),
    expiresAt: later,
    revokedAt: null,
    status: 'active',
    startedAt: at,
    expiredAt: null,
    canceledAt: null,
    consent: null,
    ip: '192.0.2.1',
    userAgent: 'SyntheticBrowser/1.0',
    // Workflow 7A (C91.1): not evaluated yet, so every network fact is null.
    networkEvaluatedAt: null,
    isTor: null,
    isDatacenter: null,
    isVpn: null,
    isProxy: null,
    hostingAsn: null,
    threatLevel: null,
    countryCode: null,
    countryName: null,
    location: null,
    ipConnectionType: null,
    networkOrganization: null,
    osName: null,
    osFullVersion: null,
    browserName: null,
    browserFullVersion: null,
    deviceType: null,
    deviceName: null,
    mobileSdkName: null,
    mobileSdkFullVersion: null,
    signalsCollected: [],
    signalBodiesDropped: 0,
    // Workflow 7A (C91.1, C96.4): no handoff created this session.
    deviceHandoffMethod: null,
    handoffFromSessionId: null,
    handoffRedeemedAt: null,
    handoffDistanceMeters: null,
    handoffCountryChanged: null,
    handoffAsnChanged: null,
    handoffRejectedAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  });

  it('maps the session with its first call details', () => {
    expect(buildInquirySessionResource(inquirySessionRecordOf(session(), at))).toMatchObject({
      attributes: {
        status: 'active',
        'started-at': at.toISOString(),
        'expires-at': later.toISOString(),
        'ip-address': '192.0.2.1',
        'user-agent': 'SyntheticBrowser/1.0',
      },
      relationships: { inquiry: { data: { type: 'inquiry', id: INQUIRY } } },
    });
  });

  it.each([
    ['an active session before its TTL', {}, at, 'active'],
    ['an active session at its TTL', {}, later, 'expired'],
    ['a session revoked in Phase 1', { revokedAt: at }, at, 'canceled'],
    ['an expired session', { status: 'expired', expiredAt: at }, at, 'expired'],
    ['a canceled session', { status: 'canceled', canceledAt: at }, at, 'canceled'],
  ] as const)('reports %s', (_label, overrides, now, status) => {
    expect(inquirySessionStatusAt(session(overrides), now)).toBe(status);
  });
});
