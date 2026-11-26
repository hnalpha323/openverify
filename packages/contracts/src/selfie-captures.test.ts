/**
 * C40: the selfie capture resource, its flow API bodies, the shared capture constants (C40.11),
 * and every contract the capture joins (ids, events, redaction stubs, verification attributes,
 * the flow session, consent, the dashboard).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SELFIE_CHECK_CONFIG_DEFAULTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_SETTINGS_DEFAULTS,
  dashboardInquiryDocumentSchema,
  dashboardSettingsSchema,
  dashboardUpdateSettingsBodySchema,
} from './dashboard-api.js';
import { EVENT_NAMES, eventSubject, type EventName } from './event-names.js';
import { eventPayloadSchema, redactedResourceStubSchema } from './events.js';
import { flowConsentBodySchema, flowSessionResponseSchema } from './flow-api.js';
import { ID_PREFIXES, anyIdSchema } from './ids.js';
import { inquiryRelationshipsSchema } from './inquiries.js';
import { inquirySessionAttributesSchema } from './inquiry-sessions.js';
import { RESOURCE_TYPES } from './resource-types.js';
import {
  CLIENT_ELAPSED_MS_FIELD,
  CLIENT_ELAPSED_MS_MAX,
  DEVICE_LABEL_MAX_LENGTH,
  FACE_SEARCH_MAX_TEMPLATES,
  FACE_TEMPLATE_RETENTION_DAYS,
  SELFIE_CAPTURE_CLIENT,
  SELFIE_CAPTURE_GUIDANCE_DEFAULTS,
  SELFIE_CAPTURE_ID_FIELD,
  SELFIE_CAPTURE_LIMIT,
  SELFIE_CAPTURE_NONCE_FIELD,
  SELFIE_CAPTURE_NONCE_LENGTH,
  SELFIE_CAPTURE_PROBLEM_CODES,
  SELFIE_CAPTURE_TTL_SECONDS,
  SELFIE_POSE_FILE_KINDS,
  buildSelfieCaptureResource,
  clientElapsedMsFieldSchema,
  createSelfieCaptureBodySchema,
  faceSearchMaxTemplatesSchema,
  faceTemplateRetentionDaysSchema,
  flowSelfieCaptureDocumentSchema,
  flowSubmitVerificationBodySchema,
  sanitizeDeviceLabel,
  selfieCaptureDocumentSchema,
  selfieCaptureNonceSchema,
  selfieCapturePromptsSchema,
  selfieCaptureResourceSchema,
  selfieDeviceSnapshotSchema,
} from './selfie-captures.js';
import { readFixture } from './test-support.js';
import {
  selfieVerificationAttributesSchema,
  verificationRelationshipsSchema,
} from './verifications.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../../contracts/fixtures');
const json = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf8')) as Record<string, unknown>;

const CAPTURE_ID = 'self_01M5CJXHG07XPHF3HRM6NREDH9';
const VERIFICATION_ID = 'ver_01M5CJXHG07XPHF3HRM6NREDH8';
const INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const ok = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('the capture constants (C40.2, C40.11)', () => {
  const constants = json('flow/selfie-capture.json') as {
    clip: Record<string, unknown>;
    client: Record<string, unknown>;
    server: Record<string, number>;
  };

  it('are the C40 values', () => {
    expect(SELFIE_CAPTURE_TTL_SECONDS).toBe(180);
    expect(SELFIE_CAPTURE_LIMIT).toBe(10);
    expect(SELFIE_CAPTURE_NONCE_LENGTH).toBe(22);
    expect(SELFIE_POSE_FILE_KINDS).toEqual({
      center: 'selfie-center',
      left: 'selfie-left',
      right: 'selfie-right',
    });
  });

  it('are read from contracts/fixtures/flow/selfie-capture.json', () => {
    expect(constants.server['capture-ttl-seconds']).toBe(SELFIE_CAPTURE_TTL_SECONDS);
    expect(SELFIE_CAPTURE_GUIDANCE_DEFAULTS).toEqual({
      'max-center-yaw-ratio': constants.server['max-center-yaw-ratio'],
      'min-side-yaw-ratio-change': constants.server['min-side-yaw-ratio-change'],
      'hold-ms': constants.client['hold-ms'],
    });
    expect(SELFIE_CAPTURE_CLIENT).toEqual({
      'side-trigger-factor': constants.client['side-trigger-factor'],
      'center-trigger-factor': constants.client['center-trigger-factor'],
      'guidance-hz': constants.client['guidance-hz'],
      'preview-width-px': constants.client['preview-width-px'],
      'manual-shutter-after-ms': constants.client['manual-shutter-after-ms'],
    });
    expect(constants.clip).toMatchObject({ width: 640, height: 480, 'frame-rate': 30 });
  });

  it('are the provisional pose defaults the server judges with (C39.3)', () => {
    const pose = SELFIE_CHECK_CONFIG_DEFAULTS.selfie_pose_detection;
    expect(pose?.['max-center-yaw-ratio']?.value).toBe(
      SELFIE_CAPTURE_GUIDANCE_DEFAULTS['max-center-yaw-ratio'],
    );
    expect(pose?.['min-side-yaw-ratio-change']?.value).toBe(
      SELFIE_CAPTURE_GUIDANCE_DEFAULTS['min-side-yaw-ratio-change'],
    );
    expect(pose?.['max-center-yaw-ratio']?.basis).toBe('provisional');
  });

  it('let the clip clear the client trigger with its 1.25 margin (C40.11)', () => {
    const measured = (
      json('flow/selfie-capture.json') as {
        measurement: { anchor: { clip_change_min: number; clears_margin: boolean } };
      }
    ).measurement.anchor;
    expect(measured.clears_margin).toBe(true);
    expect(measured.clip_change_min).toBeGreaterThanOrEqual(
      1.25 * SELFIE_CAPTURE_GUIDANCE_DEFAULTS['min-side-yaw-ratio-change'],
    );
  });
});

describe('the selfie capture resource (C40.1)', () => {
  it('has the self prefix and the selfie type', () => {
    expect(Object.values(ID_PREFIXES)).toContain('self');
    expect(anyIdSchema.safeParse(CAPTURE_ID).success).toBe(true);
    expect(RESOURCE_TYPES).toContain('selfie');
  });

  it('parses the server-only golden fixture', () => {
    expect(selfieCaptureDocumentSchema.parse(readFixture('api/selfie.json'))).toEqual(
      readFixture('api/selfie.json'),
    );
  });

  it('never carries a nonce or device data', () => {
    const resource = (readFixture('api/selfie.json') as { data: { attributes: object } }).data;
    for (const member of ['nonce', 'device', 'label', 'nonce-sha256']) {
      expect(
        ok(selfieCaptureResourceSchema, {
          ...resource,
          attributes: { ...resource.attributes, [member]: 'x' },
        }),
        member,
      ).toBe(false);
    }
  });

  it('starts its prompts at center, each pose once', () => {
    expect(ok(selfieCapturePromptsSchema, ['center'])).toBe(true);
    expect(ok(selfieCapturePromptsSchema, ['center', 'left', 'right'])).toBe(true);
    expect(ok(selfieCapturePromptsSchema, ['left', 'center'])).toBe(false);
    expect(ok(selfieCapturePromptsSchema, ['center', 'left', 'left'])).toBe(false);
    expect(ok(selfieCapturePromptsSchema, [])).toBe(false);
  });

  it('is built from a record without its nonce digest or device', () => {
    const at = new Date('2026-10-21T12:00:00.000Z');
    const resource = buildSelfieCaptureResource({
      id: CAPTURE_ID,
      verificationId: VERIFICATION_ID,
      inquiryId: INQUIRY_ID,
      status: 'errored',
      method: 'upload',
      liveness: 'passive',
      prompts: ['center'],
      promptTimings: [{ pose: 'center', clientElapsedMs: null, receivedAt: at }],
      createdAt: at,
      expiresAt: new Date(at.getTime() + SELFIE_CAPTURE_TTL_SECONDS * 1000),
      submittedAt: null,
      processedAt: null,
      errorCode: 'superseded',
    });
    expect(resource).toEqual({
      type: 'selfie',
      id: CAPTURE_ID,
      attributes: {
        status: 'errored',
        'capture-method': 'upload',
        liveness: 'passive',
        prompts: ['center'],
        'prompt-timings': [
          { pose: 'center', 'client-elapsed-ms': null, 'received-at': at.toISOString() },
        ],
        'created-at': at.toISOString(),
        'expires-at': '2026-10-21T12:03:00.000Z',
        'submitted-at': null,
        'processed-at': null,
        'error-code': 'superseded',
      },
      relationships: {
        verification: { data: { type: 'verification/selfie', id: VERIFICATION_ID } },
        inquiry: { data: { type: 'inquiry', id: INQUIRY_ID } },
      },
    });
  });
});

describe('the flow API bodies (C40.2-C40.4)', () => {
  it('create takes the capture method only', () => {
    expect(ok(createSelfieCaptureBodySchema, { method: 'camera' })).toBe(true);
    expect(ok(createSelfieCaptureBodySchema, { method: 'upload' })).toBe(true);
    expect(ok(createSelfieCaptureBodySchema, { method: 'video' })).toBe(false);
    expect(ok(createSelfieCaptureBodySchema, { method: 'camera', liveness: 'active' })).toBe(false);
  });

  it('answer create with the golden created document: prompts, expiry, nonce and guidance', () => {
    const created = json('flow/selfie-capture-created.json');
    expect(flowSelfieCaptureDocumentSchema.parse(created)).toEqual(created);
    const attributes = (created as { data: { attributes: { guidance: unknown } } }).data.attributes;
    expect(attributes.guidance).toEqual(SELFIE_CAPTURE_GUIDANCE_DEFAULTS);
  });

  it('take a 22-character base64url nonce', () => {
    expect(ok(selfieCaptureNonceSchema, 'E2eSyntheticNonce00000')).toBe(true);
    expect(ok(selfieCaptureNonceSchema, 'E2eSyntheticNonce0000')).toBe(false);
    expect(ok(selfieCaptureNonceSchema, 'E2eSyntheticNonce0000=')).toBe(false);
  });

  it('name the three upload fields and bound the client time', () => {
    expect([SELFIE_CAPTURE_ID_FIELD, SELFIE_CAPTURE_NONCE_FIELD, CLIENT_ELAPSED_MS_FIELD]).toEqual([
      'capture-id',
      'nonce',
      'client-elapsed-ms',
    ]);
    expect(CLIENT_ELAPSED_MS_MAX).toBe(600_000);
    expect(clientElapsedMsFieldSchema.parse('0')).toBe(0);
    expect(clientElapsedMsFieldSchema.parse('600000')).toBe(600_000);
    for (const value of ['600001', '-1', '1.5', '', '01', ' 5']) {
      expect(ok(clientElapsedMsFieldSchema, value), value).toBe(false);
    }
  });

  it('submit the golden capture with its device snapshot', () => {
    const body = json('flow/selfie-capture-submit.json');
    expect(flowSubmitVerificationBodySchema.parse(body)).toEqual(body);
    expect(ok(flowSubmitVerificationBodySchema, {})).toBe(true);
    expect(ok(flowSubmitVerificationBodySchema, { capture: { id: CAPTURE_ID } })).toBe(false);
  });

  it('bound every device member and refuse unknown ones', () => {
    expect(ok(selfieDeviceSnapshotSchema, {})).toBe(true);
    for (const device of [
      { gpu: 'x' },
      { settings: { width: 0 } },
      { settings: { 'frame-rate': Number.POSITIVE_INFINITY } },
      { settings: { 'facing-mode': 'sideways' } },
      { capabilities: { 'facing-modes': ['user', 'user', 'user', 'user', 'user'] } },
      { 'frame-stats': { delivered: -1 } },
      { 'frame-stats': { total: 1.5 } },
      { label: 'x'.repeat(1025) },
      { webdriver: 'yes' },
    ]) {
      expect(ok(selfieDeviceSnapshotSchema, device), JSON.stringify(device)).toBe(false);
    }
  });

  it('keep a label without control or bidi characters, at most 200 characters', () => {
    expect(DEVICE_LABEL_MAX_LENGTH).toBe(200);
    expect(sanitizeDeviceLabel('Cam\u0000era\u202e 1\n')).toBe('Camera 1');
    expect(Array.from(sanitizeDeviceLabel('\u{1F4F7}'.repeat(300)))).toHaveLength(200);
  });

  it('name the four capture problems', () => {
    expect([...SELFIE_CAPTURE_PROBLEM_CODES]).toEqual([
      'selfie_capture_limit',
      'selfie_capture_incomplete',
      'selfie_capture_invalid',
      'selfie_capture_required',
    ]);
  });
});

describe('the contracts the capture joins (C40.1, C40.8, C40.10)', () => {
  const capture = (readFixture('api/selfie.json') as { data: unknown }).data;

  it('names the selfie.* events, whose subject is the selfie', () => {
    for (const name of [
      'selfie.created',
      'selfie.submitted',
      'selfie.processed',
      'selfie.errored',
    ]) {
      expect(EVENT_NAMES).toContain(name);
      expect(eventSubject(name as EventName)).toBe('selfie');
    }
  });

  it('carries the selfie resource in an event payload', () => {
    expect(ok(eventPayloadSchema, { data: capture })).toBe(true);
  });

  it('stubs a redacted selfie with its own id prefix', () => {
    const stub = (id: string) => ({
      type: 'selfie',
      id,
      attributes: { 'redacted-at': '2026-10-21T13:00:00.000Z' },
    });
    expect(ok(redactedResourceStubSchema, stub(CAPTURE_ID))).toBe(true);
    expect(ok(redactedResourceStubSchema, stub(VERIFICATION_ID))).toBe(false);
  });

  it('gives verification/selfie the C40.10 attributes, each nullable', () => {
    const base = {
      status: 'passed',
      checks: [],
      'created-at': '2026-10-21T12:00:00.000Z',
      'updated-at': '2026-10-21T12:00:00.000Z',
    };
    expect(ok(selfieVerificationAttributesSchema, base)).toBe(true);
    const full = {
      ...base,
      'capture-method': 'camera',
      liveness: 'active',
      poses: ['center', 'left', 'right'],
      'document-similarity-score': 0.7213,
      'selfie-similarity-score-left': 0.9,
      'selfie-similarity-score-right': 0.88,
      'liveness-score': 0.97,
      'center-photo-face-coordinates': [
        [0.3, 0.2],
        [0.7, 0.2],
        [0.7, 0.75],
        [0.3, 0.75],
      ],
    };
    expect(ok(selfieVerificationAttributesSchema, full)).toBe(true);
    const nulls = Object.fromEntries(
      Object.keys(full)
        .filter((key) => !(key in base))
        .map((key) => [key, null]),
    );
    expect(ok(selfieVerificationAttributesSchema, { ...base, ...nulls })).toBe(true);
    expect(
      ok(selfieVerificationAttributesSchema, {
        ...base,
        'center-photo-face-coordinates': [
          [0.3, 0.2],
          [1.2, 0.2],
          [0.7, 0.75],
          [0.3, 0.75],
        ],
      }),
    ).toBe(false);
  });

  it('relates verifications and inquiries to their selfies', () => {
    const selfies = { data: [{ type: 'selfie', id: CAPTURE_ID }] };
    expect(
      ok(verificationRelationshipsSchema, {
        inquiry: { data: { type: 'inquiry', id: INQUIRY_ID } },
        files: { data: [] },
        selfies,
      }),
    ).toBe(true);
    expect(
      ok(inquiryRelationshipsSchema.partial(), {
        selfies,
      }),
    ).toBe(true);
  });

  it('lets the dashboard inquiry document include selfies', () => {
    const document = readFixture('api/inquiry-with-verifications.json') as {
      data: unknown;
      included?: unknown[];
    };
    expect(
      ok(dashboardInquiryDocumentSchema, {
        data: document.data,
        included: [...(document.included ?? []), capture],
      }),
    ).toBe(true);
  });

  it('gives the flow session the template retention for the consent text', () => {
    const session = readFixture('api/flow-session.json') as Record<string, unknown>;
    expect(ok(flowSessionResponseSchema, session)).toBe(true);
    expect(ok(flowSessionResponseSchema, { ...session, 'face-template-retention-days': 365 })).toBe(
      true,
    );
    expect(ok(flowSessionResponseSchema, { ...session, 'face-template-retention-days': 0 })).toBe(
      false,
    );
  });

  it('lets consent accept optional text keys (C42.3)', () => {
    const body = { accepted: true, 'text-keys': ['consent.biometric'], locale: 'en' };
    expect(ok(flowConsentBodySchema, body)).toBe(true);
    expect(
      ok(flowConsentBodySchema, { ...body, 'optional-text-keys': ['consent.biometric-matching'] }),
    ).toBe(true);
    expect(ok(flowConsentBodySchema, { ...body, 'optional-text-keys': ['Not A Key!'] })).toBe(
      false,
    );
  });

  it('shows the recorded text keys and optional text keys on a session (C47)', () => {
    const attributes = {
      status: 'active',
      'created-at': '2026-10-21T12:00:00.000Z',
      'started-at': null,
      'expires-at': '2026-10-21T13:00:00.000Z',
      'ip-address': null,
      'user-agent': null,
    };
    expect(ok(inquirySessionAttributesSchema, attributes)).toBe(true);
    expect(
      ok(inquirySessionAttributesSchema, {
        ...attributes,
        consent: {
          'accepted-at': '2026-10-21T12:01:00.000Z',
          'text-keys': ['consent.biometric', 'consent.processing'],
          'optional-text-keys': ['consent.biometric-matching'],
          locale: 'es',
        },
      }),
    ).toBe(true);
  });
});

describe('the face template settings (C42.4, C42.6)', () => {
  it('bound the retention to 1-1,095 days, default 365, and the scan to 1,000-200,000', () => {
    expect(FACE_TEMPLATE_RETENTION_DAYS).toEqual({ min: 1, max: 1095, default: 365 });
    expect(FACE_SEARCH_MAX_TEMPLATES).toEqual({ min: 1000, max: 200_000, default: 50_000 });
    expect(ok(faceTemplateRetentionDaysSchema, 1095)).toBe(true);
    expect(ok(faceTemplateRetentionDaysSchema, 1096)).toBe(false);
    expect(ok(faceSearchMaxTemplatesSchema, 999)).toBe(false);
  });

  it('are environment settings of the dashboard', () => {
    expect(DASHBOARD_SETTINGS_DEFAULTS).toMatchObject({
      'face-template-retention-days': 365,
      'face-search-max-templates': 50_000,
    });
    expect(ok(dashboardSettingsSchema, DASHBOARD_SETTINGS_DEFAULTS)).toBe(true);
    expect(ok(dashboardUpdateSettingsBodySchema, { 'face-template-retention-days': 30 })).toBe(
      true,
    );
    expect(ok(dashboardUpdateSettingsBodySchema, { 'face-search-max-templates': 500 })).toBe(false);
  });
});
