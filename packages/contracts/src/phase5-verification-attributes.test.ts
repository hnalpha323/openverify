/**
 * C52.8 and C53.7: the type attributes of the Phase 5 verification resources, each PII member
 * marked with `.meta({ pii: true })`, nullable (masked or redacted) and listed in
 * `PII_VERIFICATION_ATTRIBUTES`, which the API's masking lists consume (Stage 1b). C52.2: the
 * guidance their flow views carry, and `inputs-received` for the form types.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { AT, AT_ISO, IDS } from './test-support.js';
import {
  FLOW_VERIFICATION_RESOURCE_SCHEMAS,
  PII_VERIFICATION_ATTRIBUTES,
  VERIFICATION_RESOURCE_SCHEMAS,
  buildFlowVerificationResource,
  buildVerificationResource,
  flowVerificationResourceSchema,
  verificationResourceSchema,
} from './verifications.js';

/** C52.8: each type's attributes beyond status, checks and timestamps, PII ones marked. */
const EXAMPLES: Readonly<
  Record<string, { attributes: Record<string, unknown>; pii: readonly string[] }>
> = {
  'verification/phone-number': {
    attributes: {
      'phone-number': '+15555550100',
      'confirmed-at': AT_ISO,
      sends: 2,
      'failed-attempts': 1,
    },
    pii: ['phone-number'],
  },
  'verification/email-address': {
    attributes: {
      'email-address': 'avery@example.test',
      'confirmed-at': null,
      sends: 1,
      'failed-attempts': 0,
    },
    pii: ['email-address'],
  },
  'verification/document': {
    attributes: {
      'document-type': 'utility_bill',
      'document-type-confidence': 0.82,
      'page-count': 2,
      'mime-type': 'application/pdf',
      fields: {
        name: 'Avery Example',
        'address-street-1': '1 Sample Street',
        'address-street-2': null,
        'address-city': 'Utopia City',
        'address-subdivision': null,
        'address-postal-code': '00000',
        'address-country-code': 'US',
        'issue-date': '2026-10-01',
        issuer: 'Utopia Water Board',
        'expiration-date': null,
      },
    },
    pii: ['fields'],
  },
  'verification/database': {
    attributes: {
      'name-first': 'Avery',
      'name-middle': null,
      'name-last': 'Example',
      birthdate: '1990-04-12',
      'address-street-1': '1 Sample Street',
      'address-street-2': null,
      'address-city': 'Utopia City',
      'address-subdivision': 'UT',
      'address-postal-code': '00000',
      'address-country-code': 'US',
      'identification-number': null,
      'phone-number': null,
      'email-address': null,
    },
    pii: [
      'name-first',
      'name-middle',
      'name-last',
      'birthdate',
      'address-street-1',
      'address-street-2',
      'address-city',
      'address-subdivision',
      'address-postal-code',
      'address-country-code',
      'identification-number',
      'phone-number',
      'email-address',
    ],
  },
  'verification/aamva': {
    attributes: {
      source: 'government_id',
      'name-first': 'Avery',
      'name-last': 'Example',
      birthdate: '1990-04-12',
      'identification-number': 'D1234567',
      'issuing-authority': 'CA',
      'issue-date': '2022-01-01',
      'expiration-date': '2030-01-01',
      'address-postal-code': '90001',
    },
    pii: [
      'name-first',
      'name-last',
      'birthdate',
      'identification-number',
      'issuing-authority',
      'issue-date',
      'expiration-date',
      'address-postal-code',
    ],
  },
  'verification/crypto-wallet': {
    attributes: {
      'wallet-address': '0x52908400098527886E0F7030069857D2E4169EE7',
      'expected-address': null,
      'chain-id': 'eip155:1',
      'signature-scheme': 'eip191',
    },
    pii: ['wallet-address', 'expected-address'],
  },
  'verification/database-business': {
    attributes: {
      'business-name': 'Utopia Widgets Ltd',
      'registration-number': '01234567',
      lei: '5493000OVERIFY0TES72',
      'address-street-1': '1 Sample Street',
      'address-street-2': null,
      'address-city': 'Utopia City',
      'address-subdivision': null,
      'address-postal-code': 'UT1 1AA',
      'address-country-code': 'GB',
      'associated-persons': [
        { 'name-first': 'Avery', 'name-last': 'Example', birthdate: '1990-04' },
      ],
      'registry-record-id': '01234567',
      'registry-legal-name': 'UTOPIA WIDGETS LIMITED',
      'registry-source': 'companies-house',
      'registry-status': 'active',
    },
    pii: [
      'business-name',
      'address-street-1',
      'address-street-2',
      'address-city',
      'address-subdivision',
      'address-postal-code',
      'address-country-code',
      'associated-persons',
      'registry-legal-name',
    ],
  },
  'verification/business-website': {
    attributes: {
      'website-url': 'https://old.example/about',
      'website-domain': 'old.example',
      'domain-registered-at': AT_ISO,
    },
    pii: ['website-url', 'website-domain'],
  },
  'verification/government-id-nfc': {
    attributes: {
      'name-first': 'AVERY',
      'name-last': 'EXAMPLE',
      birthdate: '1990-04-12',
      sex: 'X',
      'expiration-date': '2031-04-11',
      'identification-number': 'UT1234567',
      nationality: 'UTO',
      'id-class': 'passport',
      'issuing-country': 'UT',
      'passive-authentication': {
        outcome: 'passed',
        integrity: 'established',
        'anchor-source': 'bsi-de',
        'hash-algorithm': 'sha-256',
        revocation: 'unrevoked',
      },
      'active-authentication': { outcome: 'not_applicable' },
    },
    pii: [
      'name-first',
      'name-last',
      'birthdate',
      'sex',
      'expiration-date',
      'identification-number',
      'nationality',
    ],
  },
};

/** A resource of `type` with `attributes`. */
function resource(type: string, attributes: Record<string, unknown>) {
  return {
    type,
    id: IDS.governmentId,
    attributes: {
      status: 'passed',
      checks: [],
      ...attributes,
      'created-at': AT_ISO,
      'updated-at': AT_ISO,
    },
    relationships: {
      inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
      files: { data: [] },
    },
  };
}

/** The attribute shape of each verification resource schema, by resource type. */
function attributeShapes(): Map<string, Record<string, z.ZodType>> {
  return new Map(
    VERIFICATION_RESOURCE_SCHEMAS.map((schema) => {
      const type = (schema.shape.type as z.ZodLiteral<string>).value;
      const attributes = schema.shape.attributes as unknown as z.ZodObject;
      return [type, attributes.shape];
    }),
  );
}

const isPii = (member: z.ZodType): boolean =>
  (member.meta() as { pii?: unknown } | undefined)?.pii === true;

describe('Phase 5 verification attributes (C52.8)', () => {
  it.each(Object.entries(EXAMPLES))('describe a %s verification', (type, example) => {
    const value = resource(type, example.attributes);
    expect(verificationResourceSchema.parse(value)).toEqual(value);
    expect(
      verificationResourceSchema.safeParse(resource(type, { ...example.attributes, extra: 1 }))
        .success,
    ).toBe(false);
  });

  it.each(Object.entries(EXAMPLES))(
    'mark exactly the PII attributes of a %s verification, each nullable',
    (type, example) => {
      const shape = attributeShapes().get(type) ?? {};
      expect(
        Object.entries(shape)
          .filter(([, member]) => isPii(member))
          .map(([name]) => name)
          .sort(),
      ).toEqual([...example.pii].sort());
      const masked = Object.fromEntries(example.pii.map((name) => [name, null]));
      expect(
        verificationResourceSchema.safeParse(resource(type, { ...example.attributes, ...masked }))
          .success,
      ).toBe(true);
    },
  );

  it.each(Object.keys(EXAMPLES))('leave every attribute of a %s verification optional', (type) => {
    expect(verificationResourceSchema.safeParse(resource(type, {})).success).toBe(true);
  });

  it('mask the document fields member-wise', () => {
    const fields = EXAMPLES['verification/document']?.attributes.fields as Record<string, unknown>;
    const masked = Object.fromEntries(Object.keys(fields).map((name) => [name, null]));
    expect(
      verificationResourceSchema.safeParse(resource('verification/document', { fields: masked }))
        .success,
    ).toBe(true);
  });

  it('are built from the record, as the attribute hooks loaded them', () => {
    const attributes = EXAMPLES['verification/crypto-wallet']?.attributes ?? {};
    const built = buildVerificationResource({
      id: IDS.governmentId,
      type: 'crypto_wallet',
      status: 'passed',
      inquiryId: IDS.inquiry,
      fileIds: [],
      checks: [],
      attributes,
      createdAt: AT,
      updatedAt: AT,
    });
    expect(built.attributes).toMatchObject(attributes);
  });
});

describe('PII_VERIFICATION_ATTRIBUTES (C53.7)', () => {
  it('lists every marked attribute of every verification resource, once', () => {
    const marked = new Set<string>();
    for (const shape of attributeShapes().values()) {
      for (const [name, member] of Object.entries(shape)) {
        if (isPii(member)) {
          marked.add(name);
        }
      }
    }
    expect([...PII_VERIFICATION_ATTRIBUTES].sort()).toEqual([...marked].sort());
    expect(new Set(PII_VERIFICATION_ATTRIBUTES).size).toBe(PII_VERIFICATION_ATTRIBUTES.length);
    expect(Object.isFrozen(PII_VERIFICATION_ATTRIBUTES)).toBe(true);
  });

  it('includes the government ID extraction and the Phase 5 PII', () => {
    for (const name of [
      'name-first',
      'birthdate',
      'personal-number',
      'phone-number',
      'email-address',
      'fields',
      'wallet-address',
      'associated-persons',
      'website-domain',
      'nationality',
    ]) {
      expect(PII_VERIFICATION_ATTRIBUTES, name).toContain(name);
    }
  });

  it('never names an attribute another resource type serves as not PII, so masking by name is safe', () => {
    const pii = new Set(PII_VERIFICATION_ATTRIBUTES);
    const clashes: string[] = [];
    for (const [type, shape] of attributeShapes()) {
      for (const [name, member] of Object.entries(shape)) {
        if (pii.has(name) && !isPii(member)) {
          clashes.push(`${type}.${name}`);
        }
      }
    }
    expect(clashes).toEqual([]);
    expect(PII_VERIFICATION_ATTRIBUTES).not.toContain('name');
    expect(PII_VERIFICATION_ATTRIBUTES).not.toContain('domain');
  });
});

describe('flow views of the Phase 5 types (C52.2)', () => {
  const GUIDANCE: Readonly<Record<string, Record<string, unknown>>> = {
    'verification/document': {
      guidance: {
        'accepted-types': ['utility_bill', 'bank_statement'],
        'max-age-days': 90,
        'max-pages': 50,
        'accepted-mime-types': ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      },
    },
    'verification/phone-number': {
      guidance: {
        'allowed-countries': ['US'],
        'code-length': 6,
        otp: {
          'masked-destination': '+1 ••• ••• 0100',
          'expires-at': AT_ISO,
          'resend-available-at': AT_ISO,
          'sends-remaining': 4,
          'attempts-remaining': 5,
        },
      },
    },
    'verification/email-address': { guidance: { 'code-length': 8, otp: null } },
    'verification/database': {
      guidance: {
        fields: ['name-first', 'name-last', 'birthdate', 'address-country-code'],
        'required-fields': ['name-first', 'name-last'],
      },
      'inputs-received': false,
    },
    'verification/aamva': { guidance: { source: 'form' }, 'inputs-received': true },
    'verification/crypto-wallet': {
      guidance: { chains: ['eip155:1'], signing: ['wallet', 'paste'] },
    },
    'verification/database-business': {
      guidance: { 'collect-associated-persons': false, 'required-inputs': ['registration-number'] },
      'inputs-received': false,
    },
    'verification/business-website': { guidance: {}, 'inputs-received': true },
    'verification/government-id-nfc': { guidance: {} },
  };

  const flow = (type: string, attributes: Record<string, unknown>) => ({
    type,
    id: IDS.governmentId,
    attributes: {
      status: 'initiated',
      'retry-hints': [],
      ...attributes,
      'created-at': AT_ISO,
      'updated-at': AT_ISO,
    },
  });

  it.each(Object.entries(GUIDANCE))('carry the guidance of a %s verification', (type, members) => {
    const value = flow(type, members);
    expect(flowVerificationResourceSchema.parse(value)).toEqual(value);
    expect(flowVerificationResourceSchema.safeParse(flow(type, { guidance: null })).success).toBe(
      true,
    );
    expect(flowVerificationResourceSchema.safeParse(flow(type, {})).success).toBe(true);
  });

  it('never carry checks or PII attributes', () => {
    for (const [type, example] of Object.entries(EXAMPLES)) {
      expect(flowVerificationResourceSchema.safeParse(flow(type, example.attributes)).success).toBe(
        false,
      );
      expect(flowVerificationResourceSchema.safeParse(flow(type, { checks: [] })).success).toBe(
        false,
      );
    }
  });

  it('carry inputs-received for the form types only', () => {
    for (const type of ['verification/phone-number', 'verification/crypto-wallet']) {
      expect(
        flowVerificationResourceSchema.safeParse(flow(type, { 'inputs-received': true })).success,
        type,
      ).toBe(false);
    }
  });

  it('are built with the flow attributes the guidance hooks give', () => {
    const members = GUIDANCE['verification/crypto-wallet'] ?? {};
    const built = buildFlowVerificationResource({
      id: IDS.governmentId,
      type: 'crypto_wallet',
      status: 'initiated',
      checks: [],
      flowAttributes: members,
      createdAt: AT,
      updatedAt: AT,
    });
    expect(built.attributes).toMatchObject(members);
    expect(FLOW_VERIFICATION_RESOURCE_SCHEMAS).toHaveLength(11);
  });
});
