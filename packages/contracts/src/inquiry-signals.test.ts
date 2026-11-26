/**
 * Workflow 7A Stage 1a (S): the inquiry's `signals` and `signal-details` (C90.5), the
 * `signal-config` template version member (C90.6), the flow session's `signals` member (C94.6),
 * and the session's device fields, relationship and include (C91.1, C91.2).
 */
import { describe, expect, it } from 'vitest';
import { flowSessionResponseSchema } from './flow-api.js';
import { buildInquiryResource, inquiryResourceSchema } from './inquiries.js';
import {
  INQUIRY_SESSION_INCLUDES,
  INQUIRY_SESSION_INCLUDE_PERMISSIONS,
  buildInquirySessionResource,
  inquirySessionIncludeDocumentSchema,
} from './inquiry-sessions.js';
import {
  createInquiryTemplateVersionBodySchema,
  inquiryTemplateVersionAttributesSchema,
} from './inquiry-template-versions.js';
import { AT, AT_ISO, IDS, LATER, LATEST, readFixture } from './test-support.js';

const record = {
  id: IDS.inquiry,
  status: 'completed',
  referenceId: null,
  fields: {},
  inquiryTemplateId: IDS.template,
  verifications: [],
  createdAt: AT,
  updatedAt: AT,
} as const;

const detail = {
  tier: 'R',
  stage: 'ga',
  version: 1,
  'null-reason': null,
  reasons: [],
  'computed-at': AT_ISO,
};

describe('the inquiry signals (C90.5)', () => {
  it('serves signals and signal-details when the record carries them', () => {
    const resource = buildInquiryResource({
      ...record,
      signals: [{ name: 'inquiry/tor_detected', value: false }],
      signalDetails: { 'computed-at': AT_ISO, 'inquiry/tor_detected': detail },
    });
    expect(resource.attributes).toMatchObject({
      signals: [{ name: 'inquiry/tor_detected', value: false }],
      'signal-details': { 'computed-at': AT_ISO },
    });
  });

  it('serves [] and computed-at alone before the job ran or when hidden (C90.8, H23)', () => {
    const resource = buildInquiryResource({
      ...record,
      signals: [],
      signalDetails: { 'computed-at': null },
    });
    expect(resource.attributes.signals).toEqual([]);
    expect(resource.attributes['signal-details']).toEqual({ 'computed-at': null });
  });

  it('refuses a false for a never-false flag, and a null without its reason (H12)', () => {
    expect(() =>
      buildInquiryResource({
        ...record,
        signals: [{ name: 'inquiry/datacenter_detected', value: false }],
        signalDetails: { 'computed-at': AT_ISO, 'inquiry/datacenter_detected': detail },
      }),
    ).toThrow();
    expect(() =>
      buildInquiryResource({
        ...record,
        signals: [{ name: 'inquiry/tor_detected', value: null }],
        signalDetails: { 'computed-at': AT_ISO, 'inquiry/tor_detected': detail },
      }),
    ).toThrow();
  });

  it('keeps an inquiry from before Phase 7 valid', () => {
    expect(inquiryResourceSchema.safeParse(buildInquiryResource(record)).success).toBe(true);
  });
});

describe('the signal-config member (C90.6)', () => {
  it('is taken by a new version and served resolved', () => {
    const fixture = readFixture('api/inquiry-template-version.json') as {
      data: { attributes: Record<string, unknown> };
    };
    const attributes = {
      ...fixture.data.attributes,
      'signal-config': { collect: 'default', 'on-signal': 'none', 'review-rules': [] },
    };
    expect(inquiryTemplateVersionAttributesSchema.safeParse(attributes).success).toBe(true);
    expect(
      createInquiryTemplateVersionBodySchema.safeParse({
        data: {
          type: 'inquiry-template-version',
          attributes: {
            'inquiry-template-id': IDS.template,
            flow: fixture.data.attributes.flow,
            'verification-config': fixture.data.attributes['verification-config'],
            'signal-config': { 'on-signal': 'needs_review' },
          },
        },
      }).success,
    ).toBe(true);
  });
});

describe('the flow session signals member (C94.6)', () => {
  it('is null before consent and names the tiers after', () => {
    const fixture = readFixture('api/flow-session.json') as Record<string, unknown>;
    expect(flowSessionResponseSchema.safeParse({ ...fixture, signals: null }).success).toBe(true);
    expect(
      flowSessionResponseSchema.safeParse({
        ...fixture,
        signals: { integrity: true, recognition: false },
      }).success,
    ).toBe(true);
  });
});

describe('the session device fields and include (C91.1, C91.2)', () => {
  it('serves the parsed device and the device relationship, and includes the device', () => {
    const session = buildInquirySessionResource({
      id: IDS.inquirySession,
      inquiryId: IDS.inquiry,
      status: 'active',
      createdAt: AT,
      startedAt: LATER,
      expiresAt: LATEST,
      ipAddress: null,
      userAgent: null,
      device: {
        osName: 'Linux',
        osFullVersion: null,
        browserName: 'Chrome',
        browserFullVersion: '140.0.0.0',
        deviceType: 'desktop',
        deviceName: null,
        mobileSdkName: null,
        mobileSdkFullVersion: null,
        signalsCollected: ['session-integrity', 'device-recognition'],
      },
      deviceId: 'dev_01J00000000000000000000000',
    });
    expect(session).toMatchObject({
      attributes: { 'os-name': 'Linux', 'device-type': 'desktop' },
      relationships: { device: { data: { type: 'device', id: 'dev_01J00000000000000000000000' } } },
    });
    expect(INQUIRY_SESSION_INCLUDES).toEqual(['device', 'network']);
    expect(INQUIRY_SESSION_INCLUDE_PERMISSIONS).toMatchObject({
      device: ['inquiry-sessions:read'],
    });
    const device = readFixture('api/device.json') as { data: unknown };
    expect(
      inquirySessionIncludeDocumentSchema.safeParse({ data: session, included: [device.data] })
        .success,
    ).toBe(true);
  });
});
