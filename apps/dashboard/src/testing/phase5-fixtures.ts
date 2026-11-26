/**
 * C54.5: the Phase 5 verifications of the golden API fixtures
 * (`contracts/fixtures/api/verification-<api-type>.json`), as the API serves them to an operator
 * with `pii:view`, or masked (C53.7) as it serves them to one without. Every value in the
 * fixtures is synthetic. Workflow 5C's per-type fixtures (`testing/fixtures/<type>.ts`) may build
 * on these.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PII_VERIFICATION_ATTRIBUTES,
  VERIFICATION_RESOURCE_TYPES,
  fileResourceSchema,
  verificationResourceSchema,
  type FileResource,
} from '@openverify/contracts';
import type { Phase5Verification } from '../components/evidence';
import { LIFECYCLE_IDS, T0 } from './lifecycle-fixtures';

export type Phase5ResourceType = Phase5Verification['type'];

/** The nine Phase 5 resource types, in their contract order. */
export const PHASE5_RESOURCE_TYPES: readonly Phase5ResourceType[] =
  VERIFICATION_RESOURCE_TYPES.filter(
    (type): type is Phase5ResourceType =>
      type !== 'verification/government-id' && type !== 'verification/selfie',
  );

/** The attributes every verification has; the rest are its type's. */
export const COMMON_ATTRIBUTES: ReadonlySet<string> = new Set([
  'status',
  'checks',
  'from-rejected-handoff',
  'created-at',
  'updated-at',
]);

const PII: ReadonlySet<string> = new Set(PII_VERIFICATION_ATTRIBUTES);

// Not `new URL(…, import.meta.url)`, which Vite rewrites into an asset URL.
const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'contracts',
  'fixtures',
  'api',
);

function golden(type: Phase5ResourceType): Phase5Verification {
  const apiType = type.slice('verification/'.length);
  const path = join(FIXTURES_DIR, `verification-${apiType}.json`);
  const { data } = JSON.parse(readFileSync(path, 'utf8')) as { data: unknown };
  return verificationResourceSchema.parse(data) as Phase5Verification;
}

/** The attributes as the API masks them (C53.7): `fields` member-wise, any other one whole. */
function masked(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => {
      if (!PII.has(name) || value === null || value === undefined) {
        return [name, value];
      }
      if (name === 'fields' && typeof value === 'object') {
        return [name, Object.fromEntries(Object.keys(value).map((field) => [field, null]))];
      }
      return [name, null];
    }),
  );
}

export interface Phase5VerificationOptions {
  /** The fixture's own id by default. */
  readonly id?: string;
  readonly inquiryId?: string;
  /** As the API serves it to an operator without `pii:view`, or after a redaction. */
  readonly masked?: boolean;
  readonly fileIds?: readonly string[];
  /** Replaces the type attributes (the common ones stay). */
  readonly attributes?: Record<string, unknown>;
}

/** The golden fixture of `type`, belonging to `LIFECYCLE_IDS.inquiry` unless told otherwise. */
export function phase5Verification(
  type: Phase5ResourceType,
  options: Phase5VerificationOptions = {},
): Phase5Verification {
  const fixture = golden(type);
  const common = Object.fromEntries(
    Object.entries(fixture.attributes).filter(([name]) => COMMON_ATTRIBUTES.has(name)),
  );
  const attributes =
    options.attributes === undefined ? fixture.attributes : { ...common, ...options.attributes };
  return verificationResourceSchema.parse({
    type,
    id: options.id ?? fixture.id,
    attributes: options.masked === true ? masked(attributes) : attributes,
    relationships: {
      inquiry: { data: { type: 'inquiry', id: options.inquiryId ?? LIFECYCLE_IDS.inquiry } },
      files: { data: (options.fileIds ?? []).map((id) => ({ type: 'file', id })) },
    },
  }) as Phase5Verification;
}

/**
 * The fixture's PII values distinctive enough to search a page or a payload for: what masking
 * must keep from the browser. Values shorter than four characters (`sex: "X"`, a nationality)
 * and runs of fewer than eight digits (a postal code such as `00000`, which every ID of the
 * page contains) are left out.
 */
export function piiValuesOf(type: Phase5ResourceType): string[] {
  return Object.entries<unknown>(golden(type).attributes)
    .filter(([name, value]) => PII.has(name) && value !== null && value !== undefined)
    .flatMap(([, value]): unknown[] =>
      typeof value === 'object' && value !== null
        ? Object.values(value as Record<string, unknown>)
        : [value],
    )
    .filter(
      (value): value is string =>
        typeof value === 'string' && value.length >= 4 && !/^\d{1,7}$/.test(value),
    );
}

/** A file of `verificationId`, of `kind` and `mimeType`. */
export function phase5File(
  id: string,
  kind: FileResource['attributes']['kind'],
  mimeType: FileResource['attributes']['mime-type'],
  verification: { readonly type: Phase5ResourceType; readonly id: string },
): FileResource {
  return fileResourceSchema.parse({
    type: 'file',
    id,
    attributes: { kind, 'mime-type': mimeType, 'byte-size': 4096, 'created-at': T0 },
    relationships: { verification: { data: { type: verification.type, id: verification.id } } },
  });
}
