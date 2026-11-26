/**
 * C156.2 (Workflow 9A, `flow-server-embed`; review F09): the console's messages, as the preview
 * accepts them: only from the exact console origin and from `window.parent`, at most
 * `FLOW_MESSAGE_MAX_BYTES` (a `preview-assets` message's buffers at most `PREVIEW_ASSETS_MAX_BYTES`
 * in all), and only in the frozen shape of `consoleToPreviewMessageSchema`. Anything else is ignored.
 */
import {
  consoleToPreviewMessageSchema,
  FLOW_MESSAGE_MAX_BYTES,
  PREVIEW_ASSETS_MAX_BYTES,
  type ConsoleToPreviewMessage,
} from '@openverify/contracts';

/** What the preview reads of a `message` event. */
export interface PreviewMessageEvent {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

/** The bytes of the transferred buffers in `data`, and the size of the rest as JSON. */
function sizes(data: unknown): { readonly buffers: number; readonly json: number } | null {
  let buffers = 0;
  try {
    const json = JSON.stringify(data, (_key, value: unknown) => {
      if (value instanceof ArrayBuffer) {
        buffers += value.byteLength;
        return null;
      }
      return value;
    });
    return { buffers, json: new TextEncoder().encode(json).byteLength };
  } catch {
    return null;
  }
}

/** The console's message in `event`, or `null` for anything else. */
export function readConsoleMessage(
  event: PreviewMessageEvent,
  expected: { readonly consoleOrigin: string | null; readonly parent: unknown },
): ConsoleToPreviewMessage | null {
  if (
    expected.consoleOrigin === null ||
    event.origin !== expected.consoleOrigin ||
    expected.parent === null ||
    event.source !== expected.parent
  ) {
    return null;
  }
  const size = sizes(event.data);
  if (
    size === null ||
    size.json > FLOW_MESSAGE_MAX_BYTES ||
    size.buffers > PREVIEW_ASSETS_MAX_BYTES
  ) {
    return null;
  }
  const parsed = consoleToPreviewMessageSchema.safeParse(event.data);
  return parsed.success ? parsed.data : null;
}
