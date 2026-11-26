/**
 * `verification/government-id-nfc` fixtures for the console tests (C62, C66), built on the
 * golden API fixture (`contracts/fixtures/api/verification-government-id-nfc.json`, a genuine
 * Utopia chip read with its face, which `integration-5b` rebuilt from what the evaluators write):
 * its checks changed one at a time, its files, the selfie its portrait was compared with, and the
 * API's masking (C53.7). Every value is synthetic; the issuer is the Utopia test state.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dashboardTrustAnchorsSchema,
  fileResourceSchema,
  verificationResourceSchema,
  type DashboardTrustAnchors,
  type FileResource,
  type VerificationCheck,
} from '@openverify/contracts';
import type { ChipVerification } from '../../lib/government-id-nfc-evidence';
import { T0 } from '../lifecycle-fixtures';
import { phase5Verification } from '../phase5-fixtures';

export const CHIP_IDS = {
  verification: 'ver_01JD0000000000000000000020',
  portrait: 'file_01JD0000000000000000000020',
  sod: 'file_01JD0000000000000000000021',
  dg1: 'file_01JD0000000000000000000022',
  dg2: 'file_01JD0000000000000000000023',
  /** The selfie verification the golden selfie comparison names. */
  selfie: 'ver_01M5CK3M4N5P6Q7R8S9T0V1W2X',
  selfieCenter: 'file_01JD0000000000000000000024',
  otherSelfie: 'ver_01JD0000000000000000000021',
  otherSelfieCenter: 'file_01JD0000000000000000000025',
} as const;

export interface ChipFixtureOptions {
  readonly masked?: boolean;
  readonly status?: ChipVerification['attributes']['status'];
  /** Replaces checks by name; `null` removes one. */
  readonly checks?: Readonly<Record<string, Partial<VerificationCheck> | null>>;
  /** Merged over the type attributes. */
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly fileIds?: readonly string[];
}

/** The golden chip read, changed as `options` says. */
export function chipVerification(options: ChipFixtureOptions = {}): ChipVerification {
  const base = phase5Verification('verification/government-id-nfc', {
    id: CHIP_IDS.verification,
    fileIds: options.fileIds ?? [CHIP_IDS.sod, CHIP_IDS.dg1, CHIP_IDS.dg2, CHIP_IDS.portrait],
    ...(options.masked === true ? { masked: true } : {}),
  });
  const replaced = options.checks ?? {};
  const checks = base.attributes.checks.flatMap((check) => {
    if (!Object.hasOwn(replaced, check.name)) {
      return [check];
    }
    const patch = replaced[check.name];
    return patch === null || patch === undefined ? [] : [{ ...check, ...patch }];
  });
  return verificationResourceSchema.parse({
    ...base,
    attributes: {
      ...base.attributes,
      ...(options.attributes ?? {}),
      ...(options.status === undefined ? {} : { status: options.status }),
      checks,
    },
  }) as ChipVerification;
}

/** One check of the golden chip read. */
export function chipCheck(name: string): VerificationCheck {
  const check = chipVerification().attributes.checks.find((result) => result.name === name);
  if (check === undefined) {
    throw new Error(`The golden chip read has no ${name}`);
  }
  return check;
}

function file(
  id: string,
  kind: FileResource['attributes']['kind'],
  mimeType: FileResource['attributes']['mime-type'],
  verification: { readonly type: string; readonly id: string },
): FileResource {
  return fileResourceSchema.parse({
    type: 'file',
    id,
    attributes: { kind, 'mime-type': mimeType, 'byte-size': 2048, 'created-at': T0 },
    relationships: { verification: { data: verification } },
  });
}

/** The chip read's files: the raw chip files (the console serves none of them) and the portrait. */
export function chipFiles(): FileResource[] {
  const owner = { type: 'verification/government-id-nfc', id: CHIP_IDS.verification };
  return [
    file(CHIP_IDS.sod, 'chip-sod', 'application/octet-stream', owner),
    file(CHIP_IDS.dg1, 'chip-dg1', 'application/octet-stream', owner),
    file(CHIP_IDS.dg2, 'chip-dg2', 'application/octet-stream', owner),
    file(CHIP_IDS.portrait, 'chip-portrait', 'image/png', owner),
  ];
}

/** The inquiry's selfie centre photos: the one the portrait was compared with, and another's. */
export function selfieCenterFiles(): FileResource[] {
  return [
    file(CHIP_IDS.otherSelfieCenter, 'selfie-center', 'image/jpeg', {
      type: 'verification/selfie',
      id: CHIP_IDS.otherSelfie,
    }),
    file(CHIP_IDS.selfieCenter, 'selfie-center', 'image/jpeg', {
      type: 'verification/selfie',
      id: CHIP_IDS.selfie,
    }),
  ];
}

// Not `new URL(…, import.meta.url)`, which Vite rewrites into an asset URL.
const TRUST_ANCHORS_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  ...['..', '..', '..', '..', '..'],
  'contracts',
  'fixtures',
  'api',
  'dashboard-trust-anchors.json',
);

/**
 * The golden `GET /dashboard/trust-anchors` answer (C62.10): two sources (the BSI list synced,
 * the Dutch one disabled), anchors of DE and FR, one withdrawn anchor, a current and an expired
 * CRL, and the Utopia sandbox anchor; `changes` replace its members.
 */
export function trustAnchorsDocument(
  changes: Partial<DashboardTrustAnchors> = {},
): DashboardTrustAnchors {
  const golden = JSON.parse(readFileSync(TRUST_ANCHORS_FIXTURE, 'utf8')) as unknown;
  return dashboardTrustAnchorsSchema.parse({ ...(golden as object), ...changes });
}

/** A trust store nothing was synced into or seeded. */
export function emptyTrustStore(): DashboardTrustAnchors {
  return trustAnchorsDocument({
    'has-production-anchor': false,
    sources: [],
    countries: [],
    'withdrawn-anchors': [],
    crls: [],
    'sandbox-anchors': [],
  });
}
