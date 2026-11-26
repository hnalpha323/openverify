/**
 * Workflow 9A Stage 1a, (F): the flow API's new routes and headers (C148.5, C151.7, C157.2, C160.6,
 * C171.4) beside `flow-api.ts`: the `OpenVerify-Flow-Spec` negotiation, the screen submission, the
 * selfie-capture extension, the flow's theme assets, and the internal embed policy, which stays out
 * of the public OpenAPI document (the route is registered without a schema transform, C174.9).
 */
import { FLOW_SPEC_VERSIONS, stepIdSchema, type FlowSpecVersion } from '@openverify/flow-spec';
import { z } from 'zod';
import { idSchema } from './ids.js';
import { MAX_ORIGIN_ENTRIES, isOriginEntry } from './origin-pattern.js';

/**
 * C151.7 (ours): the request header lists the flow-spec versions a client renders (`1, 2`); absent
 * means `1`; unknown values are ignored; the response header names the version served. Negotiation
 * changes only what is sent, never the path, a wait or the required verifications.
 */
export const FLOW_SPEC_HEADER = 'OpenVerify-Flow-Spec';

/** The versions a request's header declares, in the order given; `[1]` when it declares none. */
export function parseFlowSpecHeader(value: string | undefined): FlowSpecVersion[] {
  const known: readonly number[] = FLOW_SPEC_VERSIONS;
  const versions = (value ?? '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((version): version is FlowSpecVersion => known.includes(version));
  return versions.length === 0 ? [1] : [...new Set(versions)];
}

/**
 * `POST /api/v1/flow/screens/:stepId/submit` (C148.5). The path parameter is camelCase, as every
 * multi-word path parameter of the API is (`:attachmentId`, `:nodeId`): the router reads `-` as a
 * separator, so `:step-id` cannot be a parameter (Workflow 9A Stage 1b amendment).
 */
export const flowScreenParamsSchema = z.strictObject({ stepId: stepIdSchema });

/**
 * C148.5: the screen's values by field key, and the submit button's key (absent: the primary
 * button, port `next`). Only the current step accepts it (`flow_step_not_current`); the server
 * validates every value again and discards a hidden component's. `values` is personal data in API
 * logs (C174.5).
 */
export const submitFlowScreenBodySchema = z.strictObject({
  values: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be a field key'),
      z.union([
        z.string().max(10_000),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.string().max(10_000)).max(1000),
      ]),
    )
    .refine((values) => Object.keys(values).length <= 1000, 'at most 1,000 values')
    .meta({ pii: true }),
  button: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, 'must be a button key')
    .optional(),
});
export type SubmitFlowScreenBody = z.infer<typeof submitFlowScreenBodySchema>;

/** C174.5: the PII names of the screen submission. */
export const PII_FLOW_SCREEN_ATTRIBUTES: readonly string[] = Object.freeze(['values']);

/**
 * `POST /api/v1/flow/selfie-captures/:id/extend` (C171.4, a C3 amendment; owner `api-flow-engine`):
 * moves the capture's `expires-at` by 180 s, at least ten times per capture, outside the cap of 10;
 * refused after submit (409 `selfie_capture_not_extendable`). It answers the selfie capture.
 */
export const extendSelfieCaptureParamsSchema = z.strictObject({ id: idSchema('self') });

/** `GET /api/v1/flow/theme-assets/:id` (C160.6): an asset of the session's environment, as bytes. */
export const flowThemeAssetParamsSchema = z.strictObject({ id: idSchema('tsa') });

/**
 * `GET /api/v1/internal/embed-policies/:inquiryId` (C157.2), with the flow-server token; camelCase
 * as `flowScreenParamsSchema` (Workflow 9A Stage 1b amendment).
 */
export const embedPolicyParamsSchema = z.strictObject({ inquiryId: idSchema('inq') });

/**
 * C157.2 (V04): the internal embed-policy answer. Frozen here; the flow server checks an answer with
 * `parseEmbedPolicyAnswer` of `origin-pattern.ts` (no zod, no package index), which a contracts test
 * holds to this schema over the golden vectors.
 */
export const embedPolicyAnswerSchema = z.strictObject({
  'inquiry-id': idSchema('inq'),
  'template-id': idSchema('itmpl'),
  'environment-id': idSchema('env'),
  'frame-ancestors': z
    .array(
      z.string().refine((entry) => isOriginEntry(entry, 'sandbox'), 'must be an allowed origin'),
    )
    .max(MAX_ORIGIN_ENTRIES),
});
export type EmbedPolicyAnswerDocument = z.infer<typeof embedPolicyAnswerSchema>;
