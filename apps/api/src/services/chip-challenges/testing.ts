/**
 * Templates and chips for the API's government ID NFC tests (C62, C65.3). Only tests import this
 * file. Chips come from `@openverify/emrtd/testing` (synthetic keys from fixed seeds, the Utopia
 * test CSCA): no key, chip file or certificate is committed.
 */
import { createHash } from 'node:crypto';
import {
  defaultInquiryTemplateAttributes,
  newId,
  type DefaultInquiryTemplateAttributes,
  type FileKind,
} from '@openverify/contracts';
import {
  defaultTemplateConfig,
  emptyExtractedFields,
  type ExtractedFields,
  type ExtractionFieldSources,
  type VerificationTemplateConfig,
} from '@openverify/core';
import {
  consumeChipChallenge,
  createChipChallenge,
  createFile,
  createGovernmentIdExtraction,
  createVerification,
  encryptBytes,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
  type Keyring,
} from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import type { DataGroupNumber } from '@openverify/emrtd';
import {
  buildUtopiaChip,
  signActiveAuthentication,
  type TestChipVariant,
  type UtopiaChip,
} from '@openverify/emrtd/testing';
import type { FlowStep } from '@openverify/flow-spec';
import type { FileStorage } from '../../ports.js';
import { chipNonceSha256, newChipChallengeNonce } from './rules.js';

export interface NfcTemplateOptions {
  /** Keep the government ID step before the selfie (true by default). */
  governmentIdStep?: boolean;
  maxAttempts?: number;
  /** Changes the registry defaults of the `government-id-nfc` configuration. */
  config?: (config: VerificationTemplateConfig) => VerificationTemplateConfig;
  /** Sets the type's `accept-review-without-provider` (C50.4, H28). */
  acceptReviewWithoutProvider?: boolean;
}

/**
 * Consent, a one-sided government ID (unless left out), a selfie, then an NFC step (C50.4: after
 * the selfie and the ID), completion and failure, with the default configurations.
 */
export function nfcTemplateAttributes(
  options: NfcTemplateOptions = {},
): DefaultInquiryTemplateAttributes {
  const attributes = defaultInquiryTemplateAttributes();
  attributes.name = 'Government ID chip';
  const steps: FlowStep[] = [];
  for (const step of attributes.flow.steps) {
    if (step.type === 'government_id') {
      if (options.governmentIdStep !== false) {
        steps.push({ ...step, sides: 'front' });
      }
      continue;
    }
    if (step.type === 'completion') {
      steps.push({
        id: 'nfc',
        type: 'nfc',
        androidOnly: true,
        ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
      });
    }
    steps.push(step);
  }
  attributes.flow.steps = steps;
  attributes.flow.transitions = attributes.flow.transitions.filter(
    (transition) => options.governmentIdStep !== false || transition.from !== 'government_id',
  );
  attributes.flow.transitions.push({
    from: 'nfc',
    to: 'failure',
    condition: { '==': [{ var: 'inquiry.status' }, 'failed'] },
  });
  const nfc = defaultTemplateConfig('government_id_nfc');
  const config = options.config === undefined ? nfc : options.config(nfc);
  const verificationConfig = { ...attributes['verification-config'] };
  if (options.governmentIdStep === false) {
    delete verificationConfig['government-id'];
  }
  attributes['verification-config'] = {
    ...verificationConfig,
    'government-id-nfc': {
      ...config,
      ...(options.acceptReviewWithoutProvider === undefined
        ? {}
        : { 'accept-review-without-provider': options.acceptReviewWithoutProvider }),
    },
  };
  return attributes;
}

// Chips ----------------------------------------------------------------------------------------

/** ICAO 9303 check digit (weights 7, 3, 1; `<` is 0, letters 10 to 35). */
export function mrzCheckDigit(field: string): string {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let index = 0; index < field.length; index += 1) {
    const character = field.charAt(index);
    const code = field.charCodeAt(index);
    const value =
      character === '<'
        ? 0
        : code >= 65 && code <= 90
          ? code - 55
          : code >= 48 && code <= 57
            ? code - 48
            : 0;
    sum += value * (weights[index % 3] ?? 1);
  }
  return String(sum % 10);
}

export interface TestTd3 {
  surname: string;
  givenNames: string;
  documentNumber: string;
  /** ICAO alpha-3. */
  issuingState: string;
  nationality: string;
  /** YYMMDD. */
  birthDate: string;
  sex: 'M' | 'F' | '<';
  /** YYMMDD. */
  expiryDate: string;
}

/** The synthetic Utopia passport holder of the API's NFC tests (no real person). */
export const TEST_TD3: Readonly<TestTd3> = Object.freeze({
  surname: 'EXAMPLE',
  givenNames: 'AVERY',
  documentNumber: 'UT1234567',
  issuingState: 'UTO',
  nationality: 'UTO',
  birthDate: '900412',
  sex: 'F',
  expiryDate: '310411',
});

const pad = (value: string, length: number) => value.padEnd(length, '<').slice(0, length);

/** A TD3 MRZ (two lines of 44) with every check digit computed. */
export function td3Mrz(holder: Partial<TestTd3> = {}): [string, string] {
  const td3 = { ...TEST_TD3, ...holder };
  const name = pad(`${td3.surname}<<${td3.givenNames.replaceAll(' ', '<')}`, 39);
  const line1 = `P<${td3.issuingState}${name}`;
  const number = pad(td3.documentNumber, 9);
  const optional = pad('', 14);
  const parts = [
    `${number}${mrzCheckDigit(number)}`,
    `${td3.birthDate}${mrzCheckDigit(td3.birthDate)}`,
    `${td3.expiryDate}${mrzCheckDigit(td3.expiryDate)}`,
    `${optional}${mrzCheckDigit(optional)}`,
  ];
  const composite = mrzCheckDigit(parts.join(''));
  const line2 = `${parts[0] ?? ''}${td3.nationality}${parts[1] ?? ''}${td3.sex}${parts[2] ?? ''}${parts[3] ?? ''}${composite}`;
  return [line1, line2];
}

/** A tiny synthetic JPEG standing in for a DG2 portrait: magic bytes and padding, no face. */
export const TEST_PORTRAIT = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 0xff, 0xd9,
]);

export interface TestChipOptions {
  now: Date;
  /** The per-test seed of the DSC and the chip's keys. */
  seed?: string;
  mrz?: readonly string[];
  variants?: readonly TestChipVariant[];
  withhold?: readonly DataGroupNumber[];
}

/** A chip under the Utopia test CSCA (as `seed:dev` inserts it), with a P-256 AA key. */
export function testChip(options: TestChipOptions): UtopiaChip {
  return buildUtopiaChip({
    now: options.now,
    seed: options.seed ?? 'api-nfc/test-chip',
    mrzLines: options.mrz ?? td3Mrz(),
    portrait: { bytes: TEST_PORTRAIT, mimeType: 'image/jpeg', width: 480, height: 640 },
    ...(options.variants === undefined ? {} : { variants: options.variants }),
    ...(options.withhold === undefined ? {} : { withhold: options.withhold }),
  });
}

/** The upload kind of each chip file (C52.4). */
export const CHIP_UPLOAD_KINDS = Object.freeze({
  sod: 'chip-sod',
  1: 'chip-dg1',
  2: 'chip-dg2',
  14: 'chip-dg14',
  15: 'chip-dg15',
  com: 'chip-com',
} as const);

/** The chip's files by upload kind, as a client uploads them. */
export function chipUploads(chip: UtopiaChip): [string, Uint8Array][] {
  const { files } = chip;
  const uploads: [string, Uint8Array][] = [[CHIP_UPLOAD_KINDS.sod, files.sod]];
  for (const group of [1, 2, 14, 15] as const) {
    const bytes = files.dataGroups[group];
    if (bytes !== undefined) {
      uploads.push([CHIP_UPLOAD_KINDS[group], bytes]);
    }
  }
  if (files.com !== undefined) {
    uploads.push([CHIP_UPLOAD_KINDS.com, files.com]);
  }
  return uploads;
}

// Seeded inquiries for the job's tests --------------------------------------------------------

/** The TD3 holder's C31.5 fields, as a government ID's MRZ reading stores them. */
export function td3ExtractionFields(holder: Partial<TestTd3> = {}): ExtractedFields {
  const td3 = { ...TEST_TD3, ...holder };
  const date = (yymmdd: string, century: string) =>
    `${century}${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
  return {
    ...emptyExtractedFields(),
    'name-first': td3.givenNames,
    'name-last': td3.surname,
    birthdate: date(td3.birthDate, '19'),
    sex: td3.sex === '<' ? 'X' : td3.sex,
    nationality: td3.nationality,
    'identification-number': td3.documentNumber,
    'expiration-date': date(td3.expiryDate, '20'),
    'issuing-authority-code': td3.issuingState,
  };
}

/** Every field of a TD3 reading came from the MRZ. */
const MRZ_SOURCES = Object.freeze(
  Object.fromEntries(
    (
      [
        'name-first',
        'name-last',
        'birthdate',
        'sex',
        'nationality',
        'identification-number',
        'expiration-date',
        'issuing-authority-code',
      ] as const
    ).map((field) => [field, ['mrz'] as const]),
  ),
) as ExtractionFieldSources;

/** A synthetic selfie centre image (a JPEG's magic bytes and padding, no face). */
export const TEST_SELFIE = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3,
]);

export interface SeedNfcOptions {
  environmentId: string;
  storage: FileStorage;
  keyring: Keyring;
  now: Date;
  chip: UtopiaChip;
  /** The uploads (every chip file by default). */
  uploads?: [string, Uint8Array][];
  /** Inquiries with one reference id share an account (C13). */
  referenceId?: string;
  template?: DefaultInquiryTemplateAttributes;
  /** A passed government ID with this MRZ reading (the chip's holder by default); `null`: none. */
  governmentId?: ExtractedFields | null;
  /** A passed selfie with a centre file (true by default). */
  selfie?: boolean;
  /** The AA response: signed by the chip's key over the nonce (default), another nonce's, or none. */
  activeAuthentication?: 'valid' | 'other-nonce' | 'none';
  deviceReport?: Record<string, unknown> | null;
}

export interface SeededNfc {
  inquiryId: string;
  verificationId: string;
  selfieVerificationId: string | null;
  challengeId: string;
  nonce: string;
}

async function storeFile(
  db: Db,
  options: SeedNfcOptions,
  verificationId: string,
  kind: FileKind,
  bytes: Uint8Array,
  mimeType: string,
): Promise<void> {
  const id = newId('file');
  const sealed = encryptBytes(bytes, options.keyring, { context: id });
  const storageKey = `${options.environmentId}/${id}`;
  await options.storage.put(storageKey, sealed.ciphertext);
  await createFile(db, options.environmentId, {
    id,
    verificationId,
    kind,
    storageKey,
    mimeType,
    byteSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
}

/**
 * A pending inquiry (the NFC template unless told otherwise) with a passed government ID and
 * selfie, and a submitted NFC verification carrying the chip's files and a consumed challenge.
 */
export async function seedNfcInquiry(db: Db, options: SeedNfcOptions): Promise<SeededNfc> {
  const { environmentId, now } = options;
  const attributes = options.template ?? nfcTemplateAttributes();
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: attributes.flow,
    verificationConfig: attributes['verification-config'],
    ...(options.referenceId === undefined ? {} : { referenceId: options.referenceId }),
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const fields = options.governmentId === undefined ? td3ExtractionFields() : options.governmentId;
  if (fields !== null) {
    const id = newId('ver');
    await createVerification(db, environmentId, {
      id,
      inquiryId: inquiry.id,
      type: 'government_id',
      idClass: 'passport',
    });
    await createGovernmentIdExtraction(db, environmentId, {
      verificationId: id,
      fields,
      fieldSources: MRZ_SOURCES,
      identificationNumberIndex: null,
      frontPhash: null,
    });
    await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
    await setVerificationStatus(db, environmentId, id, { to: 'passed' });
  }
  let selfieVerificationId: string | null = null;
  if (options.selfie !== false) {
    selfieVerificationId = newId('ver');
    await createVerification(db, environmentId, {
      id: selfieVerificationId,
      inquiryId: inquiry.id,
      type: 'selfie',
    });
    await storeFile(db, options, selfieVerificationId, 'selfie-center', TEST_SELFIE, 'image/jpeg');
    await setVerificationStatus(db, environmentId, selfieVerificationId, { to: 'submitted' });
    await setVerificationStatus(db, environmentId, selfieVerificationId, { to: 'passed' });
  }
  const verificationId = newId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'government_id_nfc',
  });
  for (const [kind, bytes] of options.uploads ?? chipUploads(options.chip)) {
    await storeFile(
      db,
      options,
      verificationId,
      kind as FileKind,
      bytes,
      'application/octet-stream',
    );
  }
  const nonce = newChipChallengeNonce();
  const challengeId = newId('chc');
  await createChipChallenge(db, environmentId, {
    id: challengeId,
    verificationId,
    inquiryId: inquiry.id,
    nonceSha256: chipNonceSha256(nonce),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 300_000),
  });
  const key = options.chip.activeAuthenticationKey;
  const mode = options.activeAuthentication ?? 'valid';
  const signed =
    key === null || mode === 'none'
      ? null
      : signActiveAuthentication(
          key,
          Buffer.from(mode === 'valid' ? nonce : newChipChallengeNonce(), 'hex'),
        );
  await consumeChipChallenge(db, environmentId, {
    id: challengeId,
    verificationId,
    nonceSha256: chipNonceSha256(nonce),
    now,
    submission: {
      nonce,
      aaResponse: signed === null ? null : Buffer.from(signed).toString('base64'),
      deviceReport:
        options.deviceReport === null || options.deviceReport === undefined
          ? null
          : JSON.stringify(options.deviceReport),
    },
  });
  await setVerificationStatus(db, environmentId, verificationId, { to: 'submitted' });
  return { inquiryId: inquiry.id, verificationId, selfieVerificationId, challengeId, nonce };
}
