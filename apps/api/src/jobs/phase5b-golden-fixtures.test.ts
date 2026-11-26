/**
 * C52.8: the golden Workflow 5B verifications (`contracts/fixtures/api/verification-document`,
 * `-database-business`, `-business-website` and `-government-id-nfc`) carry what the API serves
 * for a stated synthetic input: their checks are the evaluators' results on it, mapped as the
 * resources map a stored check (the template's requirement, the registry's category), and their
 * type attributes are what the attribute hooks serve for those results. The dashboard,
 * `@openverify/node` and Android decode these files, so a changed evaluator fails here first.
 * The inputs are the ones each job assembles: vision's golden analysis, the sandbox register and
 * domain age answers, and a Utopia chip from `@openverify/emrtd/testing`. Every value is invented.
 */
import { readFileSync } from 'node:fs';
import {
  evaluateBusinessWebsiteChecks,
  evaluateDatabaseBusinessChecks,
  evaluateDocument,
  evaluateGovernmentIdNfcChecks,
  nfcChipFields,
  nfcIssuerCountry,
  nfcPassiveAuthenticationOptions,
} from '@openverify/checks';
import { checkRequirementFor, verificationDocumentSchema } from '@openverify/contracts';
import {
  defaultTemplateConfig,
  getCheckDefinition,
  type CheckModel,
  type CheckResult,
  type VerificationTemplateConfig,
} from '@openverify/core';
import {
  parseDg1,
  verifyActiveAuthentication,
  verifyPassiveAuthentication,
} from '@openverify/emrtd';
import {
  buildUtopiaChip,
  buildUtopiaCrl,
  buildUtopiaCsca,
  signActiveAuthentication,
  testTrustStore,
} from '@openverify/emrtd/testing';
import { describe, expect, it } from 'vitest';
import { sandboxRegistryAnswer } from '../providers/business-registry/sandbox.js';
import { createSandboxDomainAgeProvider } from '../providers/domain-age/sandbox.js';
import { servedDocumentFields } from '../services/attributes/document.js';
import { TEST_PORTRAIT, td3Mrz } from '../services/chip-challenges/testing.js';
import { SANDBOX_TRUST_SOURCE } from '../trust-anchors/sandbox.js';
import { MODEL_DIGESTS } from './models.js';

/** When the golden verifications were decided (their `updated-at`). */
const DECIDED_AT = new Date('2026-10-20T12:05:30.000Z');
const SANDBOX = { id: 'sandbox', sandbox: true } as const;

function golden(name: string) {
  const parsed = verificationDocumentSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../../../../contracts/fixtures/api/verification-${name}.json`, import.meta.url),
        'utf8',
      ),
    ),
  );
  return parsed.data.attributes as unknown as Record<string, unknown> & {
    checks: readonly unknown[];
  };
}

/** The results as the resource serves the stored checks (`toCheck` in the contracts). */
function served(results: readonly CheckResult[], config: VerificationTemplateConfig) {
  return results.map((result) => ({
    name: result.name,
    status: result.status,
    reasons: result.reasons,
    requirement: checkRequirementFor(config.checks[result.name]?.required === true),
    metadata: result.metadata,
    stage: result.stage,
    confidence: result.confidence,
    provenance: result.provenance,
    category: getCheckDefinition(result.name)?.category,
  }));
}

/** A model vision reports, pinned as the jobs pin it. */
function pinned(id: string): CheckModel {
  const digest = MODEL_DIGESTS[id];
  if (digest === undefined) {
    throw new Error(`no digest for ${id}`);
  }
  return { id, sha256: digest.sha256 };
}

describe('the golden document verification (C52.8, C60.6)', () => {
  const config = defaultTemplateConfig('document');
  const analysis = JSON.parse(
    readFileSync(
      new URL('../../../../contracts/fixtures/vision/analyze-document-pdf.json', import.meta.url),
      'utf8',
    ),
  ) as never;
  // The inquiry prefilled with the bill's holder, as the e2e and the docs describe.
  const { results, reading } = evaluateDocument(
    {
      vision: { kind: 'analysis', analysis },
      acceptedTypes: ['utility_bill', 'bank_statement'],
      references: {
        inquiry: {
          name: { first: 'Quinn', middle: null, last: 'Valemont' },
          address: {
            street1: '14 Lantern Row',
            street2: null,
            city: 'Meridale',
            subdivision: 'UT',
            postalCode: '00000',
            countryCode: 'US',
          },
        },
        governmentId: null,
        account: null,
      },
      models: {
        textDetector: pinned('pp-ocrv6-small-det'),
        textRecognizer: pinned('pp-ocrv6-small-rec'),
      },
      now: DECIDED_AT,
    },
    config,
  );

  it('serves the checks the document evaluators write on vision’s golden bill', () => {
    expect(golden('document').checks).toEqual(served(results, config));
  });

  it('serves the reading as its attributes', () => {
    expect(golden('document')).toMatchObject({
      status: 'passed',
      'document-type': reading?.documentType,
      'document-type-confidence': reading?.typeConfidence,
      'page-count': reading?.pageCount,
      'mime-type': 'application/pdf',
      fields: servedDocumentFields(reading?.fields ?? {}),
    });
  });
});

describe('the golden business registry verification (C52.8, C61.7)', () => {
  const config = defaultTemplateConfig('database_business');
  const values = {
    'business-name': 'Utopia Widgets Ltd',
    'country-code': 'GB',
    'registration-number': '01234567',
    'address-street-1': '1 Sample Street',
    'address-city': 'Utopia City',
    'address-postal-code': 'UT1 1AA',
  };
  const answer = sandboxRegistryAnswer({
    country: 'GB',
    businessName: values['business-name'],
    registrationNumber: values['registration-number'],
    address: {
      street1: values['address-street-1'],
      city: values['address-city'],
      postalCode: values['address-postal-code'],
    },
  });
  const results = evaluateDatabaseBusinessChecks(
    {
      values,
      collectAssociatedPersons: false,
      registry: [
        { source: 'sandbox', outcome: { kind: 'result', provider: SANDBOX, result: answer } },
      ],
    },
    config,
  );

  it('serves the checks the registry evaluators write on the sandbox register’s echo', () => {
    expect(golden('database-business').checks).toEqual(served(results, config));
  });

  it('serves the entered business and the register’s record', () => {
    const record = answer.outcome === 'found' ? answer.record : null;
    expect(golden('database-business')).toMatchObject({
      status: 'passed',
      'business-name': values['business-name'],
      'registration-number': values['registration-number'],
      'address-country-code': 'GB',
      'registry-record-id': record?.recordId,
      'registry-legal-name': record?.legalName,
      'registry-source': 'sandbox',
      'registry-status': record?.status,
    });
  });
});

describe('the golden business website verification (C52.8, C61.3, C61.4)', () => {
  const config = defaultTemplateConfig('business_website');
  const values = { 'website-url': 'https://new.example' };

  it('serves the checks the website evaluators write on a new sandbox domain', async () => {
    const age = await createSandboxDomainAgeProvider({ now: () => DECIDED_AT }).age({
      host: 'new.example',
    });
    const results = evaluateBusinessWebsiteChecks(
      {
        values,
        domainAge: { kind: 'result', provider: SANDBOX, result: age },
        environment: 'sandbox',
        now: DECIDED_AT,
      },
      config,
    );
    const attributes = golden('business-website');
    expect(attributes.checks).toEqual(served(results, config));
    const registered = results.find(
      (result) => result.name === 'business_website_domain_age_detection',
    )?.metadata['registered-at'];
    expect(attributes).toMatchObject({
      status: 'passed',
      'website-url': values['website-url'],
      'website-domain': 'new.example',
      'domain-registered-at': `${String(registered)}T00:00:00.000Z`,
    });
  });
});

describe('the golden government ID NFC verification (C52.8, C62.6)', () => {
  const config = defaultTemplateConfig('government_id_nfc');
  const now = DECIDED_AT;
  const csca = buildUtopiaCsca({ now });
  const trust = testTrustStore({ anchors: [csca], crls: [buildUtopiaCrl({ csca, now })] });
  const chip = buildUtopiaChip({
    now,
    seed: 'golden-fixture',
    mrzLines: td3Mrz(),
    portrait: { bytes: TEST_PORTRAIT, mimeType: 'image/jpeg' },
  });
  const nonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const passive = verifyPassiveAuthentication(chip.files, trust, {
    now,
    issuerCountry: nfcIssuerCountry,
    ...nfcPassiveAuthenticationOptions(config),
  });
  const key = chip.activeAuthenticationKey;
  const active = verifyActiveAuthentication({
    dg15: chip.files.dataGroups[15] ?? null,
    dg15Listed: passive.dataGroups[15] !== undefined && passive.dataGroups[15] !== 'not_listed',
    integrity: passive.integrity,
    nonce,
    response: key === null ? null : signActiveAuthentication(key, nonce),
    dg14: chip.files.dataGroups[14] ?? null,
  });
  const dg1 = parseDg1(chip.files.dataGroups[1] ?? new Uint8Array());
  /** Unit vectors whose cosine is 0.71: the live selfie against the chip portrait. */
  const face = (cosine: number) => {
    const vector = new Array<number>(128).fill(0);
    vector[0] = cosine;
    vector[1] = Math.sqrt(1 - cosine * cosine);
    return vector;
  };
  const results = evaluateGovernmentIdNfcChecks(
    {
      environment: 'sandbox',
      passiveAuthentication: passive,
      activeAuthentication: active,
      dg1,
      governmentIdStep: true,
      mrzReferences: [
        {
          verificationId: 'ver_01M5CK0A1B2C3D4E5F6G7H8J9K',
          idClass: 'passport',
          checkDigitsValid: null,
          fields: {
            'name-first': 'AVERY',
            'name-last': 'EXAMPLE',
            birthdate: '1990-04-12',
            'identification-number': 'UT1234567',
            'expiration-date': '2031-04-11',
            nationality: 'UTO',
            'issuing-authority-code': 'UTO',
          },
        },
      ],
      selfie: {
        kind: 'face',
        verificationId: 'ver_01M5CK3M4N5P6Q7R8S9T0V1W2X',
        embedding: face(1),
      },
      chipPortrait: { kind: 'face', embedding: face(0.71) },
      sightings: 0,
      faceModels: [pinned('yunet-2026may'), pinned('sface-2021dec')],
      now,
    },
    config,
  );

  it('serves the checks the NFC evaluators write on a genuine Utopia chip read with its face', () => {
    expect(golden('government-id-nfc').checks).toEqual(served(results, config));
  });

  it('serves DG1’s fields, the issuing country and the authentication outcomes', () => {
    const fields = nfcChipFields(dg1, now);
    const of = (name: string) => results.find((result) => result.name === name);
    const pa = of('id_nfc_passive_authentication_detection');
    expect(golden('government-id-nfc')).toMatchObject({
      status: 'passed',
      'name-first': fields?.['name-first'],
      'name-last': fields?.['name-last'],
      birthdate: fields?.birthdate,
      sex: fields?.sex,
      'expiration-date': fields?.['expiration-date'],
      'identification-number': fields?.['identification-number'],
      nationality: fields?.nationality,
      'id-class': fields?.['id-class'],
      'issuing-country': nfcIssuerCountry(fields?.['issuing-country'] ?? ''),
      'passive-authentication': {
        outcome: pa?.status,
        integrity: pa?.metadata.integrity,
        'anchor-source': SANDBOX_TRUST_SOURCE,
        'hash-algorithm': pa?.metadata['hash-algorithm'],
        revocation: pa?.metadata.revocation,
      },
      'active-authentication': { outcome: of('id_nfc_chip_authentication_detection')?.status },
    });
  });
});
