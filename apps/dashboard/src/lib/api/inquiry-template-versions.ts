/**
 * The template version calls the console needs beyond `@openverify/node` (C154, Workflow 9C): a
 * version with its strong `ETag`, a draft saved with `If-Match` and `meta.allow-invalid` (the
 * console always sends both, C154.2, C154.3), publish with its acknowledgements, validate, and the
 * diff of two versions. The node client sends no `If-Match` and reads no `ETag`, so these go
 * through `apiRequestWithHeaders`.
 */
import 'server-only';
import {
  inquiryTemplateVersionDocumentSchema,
  templateVersionDiffDocumentSchema,
  templateVersionValidationDocumentSchema,
  type InquiryTemplateVersionResource,
  type UpdateInquiryTemplateVersionBody,
} from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import type { z } from 'zod';
import { apiRequest, apiRequestWithHeaders } from './client';

/** A version and the strong `ETag` of its stored content. */
export interface VersionWithEtag {
  readonly version: InquiryTemplateVersionResource;
  readonly etag: string;
}

export type VersionAttributesUpdate = UpdateInquiryTemplateVersionBody['data']['attributes'];

const versionPath = (versionId: string) =>
  `/inquiry-template-versions/${encodeURIComponent(versionId)}`;

/** Whether `error` is the API's 412 `precondition_failed`: the draft changed since it was read. */
export function isPreconditionFailed(error: unknown): boolean {
  return error instanceof OpenVerifyApiError && error.status === 412;
}

function withEtag(answer: {
  readonly data: z.output<typeof inquiryTemplateVersionDocumentSchema>;
  readonly headers: Headers;
}): VersionWithEtag {
  const etag = answer.headers.get('etag');
  if (etag === null || etag === '') {
    throw new Error('The API served the version without an ETag, so it cannot be saved safely.');
  }
  return { version: answer.data.data, etag };
}

/** `GET /inquiry-template-versions/:id` with its `ETag`. */
export async function retrieveTemplateVersion(versionId: string): Promise<VersionWithEtag> {
  return withEtag(
    await apiRequestWithHeaders({
      method: 'GET',
      path: versionPath(versionId),
      schema: inquiryTemplateVersionDocumentSchema,
    }),
  );
}

/**
 * `PATCH /inquiry-template-versions/:id` of a draft with `If-Match: etag` and
 * `meta.allow-invalid: true`: a draft with problems is saved, its `validation` says so.
 * @throws {OpenVerifyApiError} 412 `precondition_failed` (`isPreconditionFailed`) when the draft
 *   changed since `etag` was read.
 */
export async function updateTemplateVersion(
  versionId: string,
  attributes: VersionAttributesUpdate,
  etag: string,
): Promise<VersionWithEtag> {
  return withEtag(
    await apiRequestWithHeaders({
      method: 'PATCH',
      path: versionPath(versionId),
      headers: { 'if-match': etag },
      body: {
        data: { type: 'inquiry-template-version', attributes },
        meta: { 'allow-invalid': true },
      },
      schema: inquiryTemplateVersionDocumentSchema,
    }),
  );
}

export interface PublishInput {
  readonly acknowledgements: readonly string[];
  readonly publishNote?: string;
}

/** `POST /inquiry-template-versions/:id/publish` with `If-Match`, the acknowledgements and the note. */
export async function publishTemplateVersion(
  versionId: string,
  input: PublishInput,
  etag: string,
): Promise<VersionWithEtag> {
  return withEtag(
    await apiRequestWithHeaders({
      method: 'POST',
      path: `${versionPath(versionId)}/publish`,
      headers: { 'if-match': etag },
      body: {
        meta: {
          ...(input.acknowledgements.length === 0
            ? {}
            : { acknowledgements: [...input.acknowledgements] }),
          ...(input.publishNote === undefined ? {} : { 'publish-note': input.publishNote }),
        },
      },
      schema: inquiryTemplateVersionDocumentSchema,
    }),
  );
}

export interface ValidateInput {
  /** An unsaved body of the members `PATCH` takes; the stored draft without it. */
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly mode?: 'save' | 'publish';
}

export type TemplateVersionValidation = z.output<
  typeof templateVersionValidationDocumentSchema
>['data']['attributes'];

/** `POST /inquiry-template-versions/:id/validate`: every rule, the async publish hooks included. */
export async function validateTemplateVersion(
  versionId: string,
  input: ValidateInput,
): Promise<TemplateVersionValidation> {
  const answer = await apiRequest({
    method: 'POST',
    path: `${versionPath(versionId)}/validate`,
    body: {
      ...(input.attributes === undefined
        ? {}
        : { data: { type: 'inquiry-template-version', attributes: input.attributes } }),
      ...(input.mode === undefined ? {} : { meta: { mode: input.mode } }),
    },
    schema: templateVersionValidationDocumentSchema,
  });
  return answer.data.attributes;
}

export type TemplateVersionDiff = z.output<
  typeof templateVersionDiffDocumentSchema
>['data']['attributes'];

/** `GET /inquiry-template-versions/:id/diff?against=`: the server's diff of two versions. */
export async function diffTemplateVersions(
  versionId: string,
  againstId: string,
): Promise<TemplateVersionDiff> {
  const answer = await apiRequest({
    method: 'GET',
    path: `${versionPath(versionId)}/diff`,
    query: { against: againstId },
    schema: templateVersionDiffDocumentSchema,
  });
  return answer.data.attributes;
}
