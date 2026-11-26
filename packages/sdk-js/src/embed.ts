/**
 * C159.2, C159.4-C159.6: `OpenVerify.embed(...)` mounts the flow in an iframe with the fixed
 * sandbox tokens (`allow-scripts allow-same-origin allow-forms allow-popups`), the camera delegated,
 * no referrer and the credentials in the fragment; posts its `hello` to the flow origin when the
 * frame loads; and accepts a message only when `event.origin` is the flow origin and
 * `event.source` its own frame, of the protocol's exact shape. `onComplete` may never fire and its
 * status is a hint (C159.6): business logic belongs on webhooks or the API.
 */
import { frameUrlOf, type FrameUrlInput } from './frame-url';
import { readFlowMessage } from './messages';

/** C159.5 (public codes). */
export type EmbedErrorCode =
  | 'application_error'
  | 'camera_error'
  | 'invalid_config'
  | 'unauthenticated'
  | 'inactive_template'
  | 'unknown';

export type EmbedEventName = 'start' | 'step-changed' | 'complete' | 'cancel' | 'error';

export interface EmbedOptions extends FrameUrlInput {
  /** The element to mount in, or a selector for it. */
  readonly container: Element | string;
  /** The frame's accessible name; default "Identity verification". */
  readonly iframeTitle?: string;
  /** A fixed height in CSS px; without one the frame follows the flow's height. */
  readonly frameHeight?: number;
  /** A maximum width in CSS px, at most 768 (public). */
  readonly frameWidth?: number;
  readonly onLoad?: () => void;
  readonly onReady?: () => void;
  /** A hint: `status` is not authoritative (C159.6). */
  readonly onComplete?: (result: { readonly inquiryId: string; readonly status: string }) => void;
  readonly onCancel?: (result: { readonly inquiryId: string }) => void;
  readonly onError?: (error: { readonly code: EmbedErrorCode; readonly message: string }) => void;
  readonly onEvent?: (event: {
    readonly name: EmbedEventName;
    readonly metadata: { readonly 'step-type'?: string };
  }) => void;
  /** Only these events reach `onEvent`; all of them when absent. */
  readonly eventsAllowlist?: readonly EmbedEventName[];
}

export interface EmbedHandle {
  /** Removes the frame and stops listening. */
  destroy(): void;
}

const MAX_WIDTH = 768;

const ERROR_WORDS: Readonly<Record<EmbedErrorCode, string>> = {
  application_error: 'The verification could not continue.',
  camera_error: 'The camera could not be used.',
  invalid_config: 'The embed options are not valid.',
  unauthenticated: 'The verification link is not valid any more.',
  inactive_template: 'This verification is not available.',
  unknown: 'Something went wrong.',
};

export function embed(options: EmbedOptions): EmbedHandle {
  const fail = (message: string): EmbedHandle => {
    if (options.onError === undefined) {
      throw new TypeError(`OpenVerify.embed: ${message}`);
    }
    options.onError({ code: 'invalid_config', message });
    return { destroy: () => undefined };
  };
  const frameUrl = frameUrlOf(options);
  if ('invalid' in frameUrl) {
    return fail(frameUrl.invalid);
  }
  const container =
    typeof options.container === 'string'
      ? document.querySelector(options.container)
      : options.container;
  if (container === null) {
    return fail('container must be an element on the page');
  }

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  frame.setAttribute('allow', 'camera');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = options.iframeTitle ?? 'Identity verification';
  const { style } = frame;
  style.border = '0';
  style.width = '100%';
  style.maxWidth = `${String(Math.min(options.frameWidth ?? MAX_WIDTH, MAX_WIDTH))}px`;
  style.height = `${String(options.frameHeight ?? 640)}px`;
  frame.src = frameUrl.url;

  const onLoad = (): void => {
    options.onLoad?.();
    frame.contentWindow?.postMessage(
      { source: 'openverify-parent', version: 1, type: 'hello' },
      frameUrl.origin,
    );
  };
  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== frameUrl.origin || event.source !== frame.contentWindow) {
      return;
    }
    const message = readFlowMessage(event.data);
    switch (message?.type) {
      case 'ready':
        options.onReady?.();
        break;
      case 'event':
        if (options.eventsAllowlist?.includes(message.name) !== false) {
          options.onEvent?.({ name: message.name, metadata: message.metadata ?? {} });
        }
        break;
      case 'resize':
        if (options.frameHeight === undefined) {
          style.height = `${String(message.height)}px`;
        }
        break;
      case 'complete':
        options.onComplete?.({ inquiryId: message['inquiry-id'], status: message.status });
        break;
      case 'cancel':
        options.onCancel?.({ inquiryId: message['inquiry-id'] });
        break;
      case 'error': {
        const code = message.code as EmbedErrorCode;
        options.onError?.({ code, message: ERROR_WORDS[code] });
        break;
      }
      default:
        break;
    }
  };

  frame.addEventListener('load', onLoad);
  window.addEventListener('message', onMessage);
  container.append(frame);
  return {
    destroy: () => {
      window.removeEventListener('message', onMessage);
      frame.removeEventListener('load', onLoad);
      frame.remove();
    },
  };
}
