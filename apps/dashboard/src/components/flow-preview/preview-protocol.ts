/**
 * C156.2 (Workflow 9C, `dashboard-preview`): the console's half of the preview protocol (ours,
 * versioned; `packages/contracts/src/flow-messages.ts`). The console posts to the frame only with
 * the flow origin as `targetOrigin`, and accepts a message only when `event.origin` is the flow
 * origin and `event.source` the frame's `contentWindow`, at most `FLOW_MESSAGE_MAX_BYTES`, parsed
 * with `previewToConsoleMessageSchema`; anything else is ignored. No message carries a person's
 * value: the preview document holds configuration and synthetic guidance only (C156.1).
 */
import {
  FLOW_MESSAGE_MAX_BYTES,
  PREVIEW_ASSETS_MAX_BYTES,
  previewToConsoleMessageSchema,
  type ConsoleToPreviewMessage,
  type PreviewToConsoleMessage,
  type templatePreviewDocumentSchema,
} from '@openverify/contracts';
import type { z } from 'zod';

type TemplatePreviewDocument = z.output<typeof templatePreviewDocumentSchema>;

/** What the console reads of a `message` event. */
export interface ConsoleMessageEvent {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

/** Whether the frame can be shown, and from where. */
export type FramePlan =
  | { readonly kind: 'frame'; readonly origin: string; readonly src: string }
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'same-origin' };

export type PreviewViewport = 320 | 375 | 768;
export type PreviewScheme = 'light' | 'dark' | 'auto';
export type PreviewOutcome = 'passed' | 'failed' | 'needs_review';

/** C156.2: the viewport presets, in CSS px. */
export const PREVIEW_VIEWPORTS: readonly PreviewViewport[] = [320, 375, 768];
export const PREVIEW_SCHEMES: readonly PreviewScheme[] = ['light', 'dark', 'auto'];
export const PREVIEW_OUTCOMES: readonly PreviewOutcome[] = ['passed', 'failed', 'needs_review'];

export interface PreviewAssetRef {
  readonly assetId: string;
  readonly kind: 'logo' | 'font';
}
export interface PreviewAsset extends PreviewAssetRef {
  readonly bytes: ArrayBuffer;
}

/** The size of `data` as UTF-8 JSON, or `null` when it cannot be serialised (a cycle, a BigInt). */
function jsonBytesOf(data: unknown): number | null {
  try {
    // `undefined` for a function or `undefined` itself, whatever the declared type says.
    const json = JSON.stringify(data) as string | undefined;
    return json === undefined ? null : new TextEncoder().encode(json).byteLength;
  } catch {
    return null;
  }
}

/** The preview's message in `event`, or `null` for anything else. */
export function readPreviewMessage(
  event: ConsoleMessageEvent,
  expected: { readonly flowOrigin: string; readonly frame: unknown },
): PreviewToConsoleMessage | null {
  if (
    event.origin !== expected.flowOrigin ||
    expected.frame === null ||
    expected.frame === undefined ||
    event.source !== expected.frame
  ) {
    return null;
  }
  const size = jsonBytesOf(event.data);
  if (size === null || size > FLOW_MESSAGE_MAX_BYTES) {
    return null;
  }
  const parsed = previewToConsoleMessageSchema.safeParse(event.data);
  return parsed.success ? parsed.data : null;
}

/**
 * The frame's source: `{flow origin}/preview`. `allow-same-origin` only keeps the flow its own
 * origin, so the console refuses to frame its own origin (a configuration error).
 */
export function framePlanOf(flowOrigin: string | null, consoleOrigin: string): FramePlan {
  if (flowOrigin === null) {
    return { kind: 'not-configured' };
  }
  if (flowOrigin === consoleOrigin) {
    return { kind: 'same-origin' };
  }
  return { kind: 'frame', origin: flowOrigin, src: `${flowOrigin}/preview` };
}

/** Whether a console message fits the preview's 1 MiB cap, measured as JSON. */
export function fitsMessage(message: ConsoleToPreviewMessage): boolean {
  const size = jsonBytesOf(message);
  return size !== null && size <= FLOW_MESSAGE_MAX_BYTES;
}

/** The theme's logo and uploaded font, the assets a preview document needs (C160.7). */
export function themeAssetsOf(document: TemplatePreviewDocument): PreviewAssetRef[] {
  const { theme } = document.data.attributes;
  return [
    ...(theme.logo === null ? [] : [{ assetId: theme.logo['asset-id'], kind: 'logo' as const }]),
    ...(theme.font.kind === 'uploaded'
      ? [{ assetId: theme.font['asset-id'], kind: 'font' as const }]
      : []),
  ];
}

/**
 * The `preview-assets` message for `assets`, with the buffers to transfer; `null` for none, or
 * when they hold more than `PREVIEW_ASSETS_MAX_BYTES` in all (the preview would ignore it).
 */
export function assetsMessageOf(
  assets: readonly PreviewAsset[],
): { readonly message: ConsoleToPreviewMessage; readonly transfer: ArrayBuffer[] } | null {
  const total = assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0);
  if (assets.length === 0 || total > PREVIEW_ASSETS_MAX_BYTES) {
    return null;
  }
  return {
    message: {
      source: 'openverify-console',
      version: 1,
      type: 'preview-assets',
      assets: assets.map(({ assetId, kind, bytes }) => ({ 'asset-id': assetId, kind, bytes })),
    },
    transfer: assets.map(({ bytes }) => bytes),
  };
}

const HEADER = { source: 'openverify-console', version: 1 } as const;

/** The console's other messages, in the contract's shape. */
export const consoleMessages = {
  document: (document: TemplatePreviewDocument): ConsoleToPreviewMessage => ({
    ...HEADER,
    type: 'preview-document',
    document: document as unknown as Record<string, unknown>,
  }),
  selectStep: (stepId: string): ConsoleToPreviewMessage => ({
    ...HEADER,
    type: 'select-step',
    'step-id': stepId,
  }),
  outcome: (stepId: string, outcome: PreviewOutcome): ConsoleToPreviewMessage => ({
    ...HEADER,
    type: 'set-outcome',
    'step-id': stepId,
    outcome,
  }),
  viewport: (width: PreviewViewport): ConsoleToPreviewMessage => ({
    ...HEADER,
    type: 'set-viewport',
    width,
  }),
  scheme: (scheme: PreviewScheme): ConsoleToPreviewMessage => ({
    ...HEADER,
    type: 'set-scheme',
    scheme,
  }),
} as const;
