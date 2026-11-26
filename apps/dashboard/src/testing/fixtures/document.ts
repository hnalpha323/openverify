/**
 * `verification/document` fixtures for the console tests (C60, C66), built on the golden API
 * fixture (`contracts/fixtures/api/verification-document.json`, which `integration-5b` rebuilt
 * from what the evaluators write): the Utopia Water Board bill of a synthetic holder, its checks
 * changed one at a time, its files, and the API's masking (C53.7). Every value is synthetic.
 */
import {
  verificationResourceSchema,
  type FileResource,
  type VerificationCheck,
} from '@openverify/contracts';
import type { DocumentVerification } from '../../lib/document-evidence';
import { phase5File, phase5Verification } from '../phase5-fixtures';

export const DOCUMENT_IDS = {
  verification: 'ver_01JD0000000000000000000010',
  original: 'file_01JD0000000000000000000010',
  preview: 'file_01JD0000000000000000000011',
  olderPreview: 'file_01JD0000000000000000000012',
} as const;

export interface DocumentFixtureOptions {
  readonly id?: string;
  readonly masked?: boolean;
  readonly status?: DocumentVerification['attributes']['status'];
  /** Replaces checks by name; `null` removes one. */
  readonly checks?: Readonly<Record<string, Partial<VerificationCheck> | null>>;
  /** Merged over the type attributes. */
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly fileIds?: readonly string[];
}

/** The golden bill, changed as `options` says. */
export function documentVerification(options: DocumentFixtureOptions = {}): DocumentVerification {
  const base = phase5Verification('verification/document', {
    id: options.id ?? DOCUMENT_IDS.verification,
    fileIds: options.fileIds ?? [DOCUMENT_IDS.original, DOCUMENT_IDS.preview],
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
  }) as DocumentVerification;
}

/** One check of the golden bill. */
export function documentCheck(name: string): VerificationCheck {
  const check = documentVerification().attributes.checks.find((result) => result.name === name);
  if (check === undefined) {
    throw new Error(`The golden document has no ${name}`);
  }
  return check;
}

/** The bill's files: the upload (a PDF by default) and its page-1 preview. */
export function documentFiles(
  verification: { readonly id: string } = { id: DOCUMENT_IDS.verification },
  original: FileResource['attributes']['mime-type'] = 'application/pdf',
): FileResource[] {
  const owner = { type: 'verification/document' as const, id: verification.id };
  return [
    phase5File(DOCUMENT_IDS.original, 'document', original, owner),
    phase5File(DOCUMENT_IDS.preview, 'document-preview', 'image/png', owner),
  ];
}
