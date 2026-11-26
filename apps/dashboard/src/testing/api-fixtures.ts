/**
 * Synthetic dashboard API documents for tests. No real people, no real identifiers: every ID
 * is a made-up ULID and every value is invented.
 */
import type {
  DashboardInquiryDocument,
  DashboardSessionResponse,
  InquiryListDocument,
  InquiryResource,
} from '@openverify/contracts';

export const IDS = {
  inquiry: 'inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
  otherInquiry: 'inq_01J9ZK3M5Q7R8S9T0V1W2X3Y50',
  template: 'itmpl_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
  governmentId: 'ver_01J9ZK3M5Q7R8S9T0V1W2X3Y41',
  selfie: 'ver_01J9ZK3M5Q7R8S9T0V1W2X3Y42',
  front: 'file_01J9ZK3M5Q7R8S9T0V1W2X3Y43',
  back: 'file_01J9ZK3M5Q7R8S9T0V1W2X3Y44',
  selfieCenter: 'file_01J9ZK3M5Q7R8S9T0V1W2X3Y45',
  user: 'usr_01J9ZK3M5Q7R8S9T0V1W2X3Y46',
} as const;

export const SESSION_TOKEN = `ovu_${'S'.repeat(43)}`;
export const CREATED_AT = '2026-10-20T04:35:00.000Z';
export const UPDATED_AT = '2026-10-20T04:40:00.000Z';
export const EXPIRES_AT = '2026-10-20T16:35:00.000Z';

export function inquiryResource(
  overrides: Partial<InquiryResource['attributes']> = {},
  id: string = IDS.inquiry,
): InquiryResource {
  return {
    type: 'inquiry',
    id,
    attributes: {
      status: 'completed',
      'reference-id': 'ref-synthetic-001',
      fields: {},
      'created-at': CREATED_AT,
      'updated-at': UPDATED_AT,
      ...overrides,
    },
    relationships: {
      'inquiry-template': { data: { type: 'inquiry-template', id: IDS.template } },
      verifications: { data: [] },
    },
  };
}

export function listDocument(
  data: InquiryResource[] = [inquiryResource()],
  next: string | null = null,
): InquiryListDocument {
  return { data, links: { next } };
}

export function sessionResponse(): DashboardSessionResponse {
  return {
    token: SESSION_TOKEN,
    'expires-at': EXPIRES_AT,
    user: {
      type: 'user',
      id: IDS.user,
      attributes: {
        email: 'operator@example.test',
        'created-at': CREATED_AT,
        'updated-at': CREATED_AT,
      },
    },
  };
}

/** A completed inquiry: a government ID (front and back) and a selfie that failed a check. */
export function inquiryDocument(): DashboardInquiryDocument {
  return {
    data: {
      ...inquiryResource({ status: 'failed', fields: { name_first: 'Synthetic', age: 42 } }),
      relationships: {
        'inquiry-template': { data: { type: 'inquiry-template', id: IDS.template } },
        verifications: {
          data: [
            { type: 'verification/government-id', id: IDS.governmentId },
            { type: 'verification/selfie', id: IDS.selfie },
          ],
        },
      },
    },
    included: [
      {
        type: 'verification/government-id',
        id: IDS.governmentId,
        attributes: {
          status: 'passed',
          country: 'US',
          'id-class': 'drivers_license',
          checks: [
            {
              name: 'id_blur_detection',
              status: 'passed',
              reasons: [],
              requirement: 'required',
              metadata: {},
            },
            {
              name: 'id_glare_detection',
              status: 'passed',
              reasons: [],
              requirement: 'required',
              metadata: {},
            },
          ],
          'created-at': CREATED_AT,
          'updated-at': UPDATED_AT,
        },
        relationships: {
          inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
          files: {
            data: [
              { type: 'file', id: IDS.front },
              { type: 'file', id: IDS.back },
            ],
          },
        },
      },
      {
        type: 'verification/selfie',
        id: IDS.selfie,
        attributes: {
          status: 'failed',
          checks: [
            {
              name: 'selfie_id_comparison',
              status: 'failed',
              reasons: ['face_mismatch'],
              requirement: 'required',
              metadata: { similarity: 0.12 },
            },
            {
              name: 'selfie_multiple_faces_detection',
              status: 'not_applicable',
              reasons: [],
              requirement: 'not_required',
              metadata: {},
            },
          ],
          'created-at': CREATED_AT,
          'updated-at': UPDATED_AT,
        },
        relationships: {
          inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
          files: { data: [{ type: 'file', id: IDS.selfieCenter }] },
        },
      },
      fileResource(IDS.front, 'front', IDS.governmentId, 'verification/government-id'),
      fileResource(IDS.back, 'back', IDS.governmentId, 'verification/government-id'),
      fileResource(IDS.selfieCenter, 'selfie-center', IDS.selfie, 'verification/selfie'),
    ],
  };
}

function fileResource(
  id: string,
  kind: 'front' | 'back' | 'selfie-center',
  verificationId: string,
  verificationType: 'verification/government-id' | 'verification/selfie',
) {
  return {
    type: 'file' as const,
    id,
    attributes: {
      kind,
      'mime-type': 'image/jpeg' as const,
      'byte-size': 2048,
      'created-at': CREATED_AT,
      // Workflow 10B (C206): client-reported, null when the client sent none.
      'capture-method': null,
      'capture-trigger': null,
    },
    relationships: { verification: { data: { type: verificationType, id: verificationId } } },
  };
}
