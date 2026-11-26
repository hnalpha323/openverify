/**
 * The contract builders' Phase 4 members (Workflow 4A Stage 3, api-flow): a selfie verification's
 * captures and C40.10 attributes, an inquiry's `selfies` relationship (C40.1), and an inquiry
 * session's recorded consent (C42.3, C47). Each is sent only when the record carries it.
 */
import { describe, expect, it } from 'vitest';
import { buildInquiryResource, inquiryIncludeDocumentSchema } from './inquiries.js';
import { buildInquirySessionResource } from './inquiry-sessions.js';
import { AT, AT_ISO, IDS } from './test-support.js';
import { buildVerificationResource, verificationDocumentSchema } from './verifications.js';

const CAPTURE = 'self_01M5CJXHG07XPHF3HRM6NREDH9';

const inquiryRecord = {
  id: IDS.inquiry,
  status: 'pending' as const,
  referenceId: null,
  fields: {},
  inquiryTemplateId: IDS.template,
  verifications: [],
  createdAt: AT,
  updatedAt: AT,
};

const selfieRecord = {
  id: IDS.selfie,
  type: 'selfie' as const,
  status: 'submitted' as const,
  inquiryId: IDS.inquiry,
  fileIds: [],
  checks: [
    {
      name: 'selfie_liveness_detection',
      status: 'passed' as const,
      reasons: [],
      required: true,
      metadata: { 'liveness-score': 0.91 },
    },
  ],
  createdAt: AT,
  updatedAt: AT,
};

describe('the inquiry selfies relationship (C40.1)', () => {
  it('lists the captures when the record carries them, and is left out otherwise', () => {
    const withCaptures = buildInquiryResource({ ...inquiryRecord, selfieCaptureIds: [CAPTURE] });
    const without = buildInquiryResource(inquiryRecord);

    expect(withCaptures.relationships.selfies).toEqual({ data: [{ type: 'selfie', id: CAPTURE }] });
    expect(without.relationships).not.toHaveProperty('selfies');
  });

  it('may include verifications and captures together', () => {
    const document = {
      data: buildInquiryResource({ ...inquiryRecord, selfieCaptureIds: [] }),
      included: [buildVerificationResource(selfieRecord)],
    };

    expect(inquiryIncludeDocumentSchema.parse(document)).toEqual(document);
  });
});

describe('a selfie verification with its captures (C40.1, C40.10)', () => {
  it('sends the selfies relationship and the C40.10 attributes when the record carries them', () => {
    const resource = buildVerificationResource({
      ...selfieRecord,
      selfie: {
        captureIds: [CAPTURE],
        capture: { method: 'camera', liveness: 'active', prompts: ['center', 'left', 'right'] },
      },
    });

    expect(resource.relationships.selfies).toEqual({ data: [{ type: 'selfie', id: CAPTURE }] });
    expect(resource.attributes).toMatchObject({
      'capture-method': 'camera',
      liveness: 'active',
      poses: ['center', 'left', 'right'],
      'liveness-score': 0.91,
      'document-similarity-score': null,
    });
    expect(verificationDocumentSchema.parse({ data: resource })).toEqual({ data: resource });
  });

  it('sends neither without them', () => {
    const resource = buildVerificationResource(selfieRecord);

    expect(resource.relationships).not.toHaveProperty('selfies');
    expect(resource.attributes).not.toHaveProperty('liveness-score');
  });
});

describe('the inquiry session consent (C42.3, C47)', () => {
  const session = {
    id: IDS.inquirySession,
    inquiryId: IDS.inquiry,
    status: 'active' as const,
    createdAt: AT,
    startedAt: null,
    expiresAt: AT,
    ipAddress: null,
    userAgent: null,
  };

  it('shows the recorded keys and locale, or null before consent, and nothing when left out', () => {
    const recorded = buildInquirySessionResource({
      ...session,
      consent: {
        acceptedAt: AT,
        textKeys: ['consent.biometric'],
        optionalTextKeys: ['consent.biometric-matching'],
        locale: 'es',
      },
    });

    expect(recorded.attributes.consent).toEqual({
      'accepted-at': AT_ISO,
      'text-keys': ['consent.biometric'],
      'optional-text-keys': ['consent.biometric-matching'],
      locale: 'es',
    });
    expect(
      buildInquirySessionResource({ ...session, consent: null }).attributes.consent,
    ).toBeNull();
    expect(buildInquirySessionResource(session).attributes).not.toHaveProperty('consent');
  });
});
