/**
 * C156.2, C159.4 (Workflow 9A Stage 1a, (F)): the versioned `postMessage` protocols, ours. Each side
 * checks `event.origin` (the exact origin, through `matchesOriginPattern` for the embed's parent)
 * and `event.source` (`window.parent`, the iframe's `contentWindow`), parses with these schemas,
 * caps a message at `FLOW_MESSAGE_MAX_BYTES` and ignores anything else. No message carries personal
 * data, a token, a step id (outside the console's own preview) or a field value.
 */
import { stepIdSchema } from '@openverify/flow-spec';
import { INQUIRY_STATUSES } from '@openverify/core';
import { z } from 'zod';
import { idSchema } from './ids.js';

/** C156.2, C159.4: a message larger than this, serialised, is ignored. */
export const FLOW_MESSAGE_MAX_BYTES = 1024 * 1024;
/** C156.2 (review F09): the logo and font a `preview-assets` message transfers, in all. */
export const PREVIEW_ASSETS_MAX_BYTES = 1024 * 1024;

// The console and the preview (C156.2) -------------------------------------------------------

const consoleMessage = <const Type extends string, Shape extends z.ZodRawShape>(
  type: Type,
  shape: Shape,
) =>
  z.strictObject({
    source: z.literal('openverify-console'),
    version: z.literal(1),
    type: z.literal(type),
    ...shape,
  });

/**
 * A transferred `ArrayBuffer` (C160.3, preview assets). `z.instanceof` cannot be written as JSON
 * Schema, which every exported schema must be, so the check is a refinement over `unknown` (an
 * empty JSON Schema: the bytes never cross JSON) typed as the buffer it guarantees.
 */
const arrayBufferSchema = z.unknown().refine((value) => value instanceof ArrayBuffer, {
  message: 'must be an ArrayBuffer',
}) as unknown as z.ZodType<ArrayBuffer>;

/**
 * The console's messages to the preview, posted with the flow origin as `targetOrigin`. The preview
 * document is the answer of `POST .../preview`; assets are transferred `ArrayBuffer`s the preview
 * sniffs again (PNG, JPEG or WebP; `wOF2`) before any `blob:` or `FontFace` use.
 */
export const consoleToPreviewMessageSchema = z.discriminatedUnion('type', [
  consoleMessage('preview-document', { document: z.record(z.string(), z.unknown()) }),
  consoleMessage('select-step', { 'step-id': stepIdSchema }),
  consoleMessage('set-outcome', {
    'step-id': stepIdSchema,
    outcome: z.enum(['passed', 'failed', 'needs_review']),
  }),
  consoleMessage('set-viewport', {
    width: z.union([z.literal(320), z.literal(375), z.literal(768)]),
  }),
  consoleMessage('set-scheme', { scheme: z.enum(['light', 'dark', 'auto']) }),
  consoleMessage('preview-assets', {
    assets: z
      .array(
        z.strictObject({
          'asset-id': idSchema('tsa'),
          kind: z.enum(['logo', 'font']),
          bytes: arrayBufferSchema,
        }),
      )
      .max(2),
  }),
]);
export type ConsoleToPreviewMessage = z.infer<typeof consoleToPreviewMessageSchema>;

const previewMessage = <const Type extends string, Shape extends z.ZodRawShape>(
  type: Type,
  shape: Shape,
) =>
  z.strictObject({
    source: z.literal('openverify-preview'),
    version: z.literal(1),
    type: z.literal(type),
    ...shape,
  });

/** The preview's messages to the exact console origin. */
export const previewToConsoleMessageSchema = z.discriminatedUnion('type', [
  previewMessage('ready', {}),
  previewMessage('error', { code: z.enum(['malformed-document', 'asset-refused', 'unknown']) }),
  previewMessage('navigated', { 'step-id': stepIdSchema }),
]);
export type PreviewToConsoleMessage = z.infer<typeof previewToConsoleMessageSchema>;

// The embed client and the flow (C159.4) ------------------------------------------------------

/** The embedding page's one message: its hello, posted to the flow origin. */
export const parentToFlowMessageSchema = z.strictObject({
  source: z.literal('openverify-parent'),
  version: z.literal(1),
  type: z.literal('hello'),
});
export type ParentToFlowMessage = z.infer<typeof parentToFlowMessageSchema>;

/** C159.5 (public codes): what `onError` receives. */
export const EMBED_ERROR_CODES = [
  'application_error',
  'camera_error',
  'invalid_config',
  'unauthenticated',
  'inactive_template',
  'unknown',
] as const;

const flowMessage = <const Type extends string, Shape extends z.ZodRawShape>(
  type: Type,
  shape: Shape,
) =>
  z.strictObject({
    source: z.literal('openverify-flow'),
    version: z.literal(1),
    type: z.literal(type),
    ...shape,
  });

/**
 * The flow's messages to the embedding page, only after a valid hello and only to its exact origin.
 * `step-changed` names the step's type, never its id. `complete`'s status is a hint, never
 * authoritative (C159.6).
 */
export const flowToParentMessageSchema = z.discriminatedUnion('type', [
  flowMessage('ready', {}),
  flowMessage('event', {
    name: z.enum(['start', 'step-changed', 'complete', 'cancel', 'error']),
    metadata: z.strictObject({ 'step-type': z.string().max(40).optional() }).optional(),
  }),
  flowMessage('resize', { height: z.int().min(0).max(100_000) }),
  flowMessage('complete', { 'inquiry-id': idSchema('inq'), status: z.enum(INQUIRY_STATUSES) }),
  flowMessage('cancel', { 'inquiry-id': idSchema('inq') }),
  flowMessage('error', { code: z.enum(EMBED_ERROR_CODES) }),
]);
export type FlowToParentMessage = z.infer<typeof flowToParentMessageSchema>;
