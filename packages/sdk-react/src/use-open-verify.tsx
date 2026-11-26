'use client';
/**
 * `useOpenVerify` (plan C266.2): mounts `@openverify/js`'s embed in the element its `ref` is given
 * and keeps the embed's own events as state, nothing else. It adds no capability the embed lacks:
 * the frame, its sandbox, the message checks and the error words are the embed's (C159.2-C159.6).
 *
 * - The frame is mounted again only when what identifies it changes (the flow URL, the inquiry,
 *   the credential, the language, the style variant, the title, the size or the event allowlist);
 *   a new handler is called from the next event on, without a new frame.
 * - Options the embed refuses become the state `error` with the code `invalid_config` (and reach
 *   `onError`), so a render never throws for them.
 * - The completion is a hint (C159.6): the server decides, so business logic belongs on webhooks
 *   or the API.
 */
import { embed, type EmbedErrorCode, type EmbedEventName, type EmbedOptions } from '@openverify/js';
import { useEffect, useRef, useState } from 'react';

/** Every option of `OpenVerify.embed` but the container, which the hook's `ref` supplies. */
export type OpenVerifyOptions = Omit<EmbedOptions, 'container'>;

/** Where the embed is, as its own events tell it. */
export type OpenVerifyStatus = 'mounting' | 'loaded' | 'ready' | 'complete' | 'cancelled' | 'error';

export interface OpenVerifyState {
  readonly status: OpenVerifyStatus;
  /** The flow's last event: its name and step type, never a value the person entered. */
  readonly lastEvent: {
    readonly name: EmbedEventName;
    readonly metadata: { readonly 'step-type'?: string };
  } | null;
  /** The flow's completion message: a hint, never the decision (C159.6). */
  readonly completion: { readonly inquiryId: string; readonly status: string } | null;
  readonly error: { readonly code: EmbedErrorCode; readonly message: string } | null;
}

export interface OpenVerifyBinding {
  /** Give it to the element the flow mounts in. */
  readonly ref: (element: HTMLElement | null) => void;
  readonly state: OpenVerifyState;
}

export const INITIAL_OPEN_VERIFY_STATE: OpenVerifyState = Object.freeze({
  status: 'mounting',
  lastEvent: null,
  completion: null,
  error: null,
});

/** The state of one mounted frame, named by the key of the options it was mounted with. */
interface KeyedState {
  readonly key: string;
  readonly state: OpenVerifyState;
}

export function useOpenVerify(options: OpenVerifyOptions): OpenVerifyBinding {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [keyed, setKeyed] = useState<KeyedState | null>(null);
  // The newest handlers, read when an event arrives, so a new handler needs no new frame.
  const handlers = useRef(options);
  useEffect(() => {
    handlers.current = options;
  });

  const {
    flowUrl,
    inquiryId,
    sessionToken,
    oneTimeLink,
    language,
    styleVariant,
    iframeTitle,
    frameHeight,
    frameWidth,
    eventsAllowlist,
  } = options;
  const allowlist = eventsAllowlist?.join(' ');
  const key = JSON.stringify([
    flowUrl,
    inquiryId,
    sessionToken,
    oneTimeLink,
    language,
    styleVariant,
    iframeTitle,
    frameHeight,
    frameWidth,
    allowlist,
  ]);

  useEffect(() => {
    if (element === null) {
      return undefined;
    }
    let mounted = true;
    const update = (change: Partial<OpenVerifyState>): void => {
      if (!mounted) {
        return;
      }
      setKeyed((previous) => ({
        key,
        state: {
          ...(previous?.key === key ? previous.state : INITIAL_OPEN_VERIFY_STATE),
          ...change,
        },
      }));
    };
    const frameOptions: EmbedOptions = {
      container: element,
      flowUrl,
      inquiryId,
      ...(sessionToken === undefined ? {} : { sessionToken }),
      ...(oneTimeLink === undefined ? {} : { oneTimeLink }),
      ...(language === undefined ? {} : { language }),
      ...(styleVariant === undefined ? {} : { styleVariant }),
      ...(iframeTitle === undefined ? {} : { iframeTitle }),
      ...(frameHeight === undefined ? {} : { frameHeight }),
      ...(frameWidth === undefined ? {} : { frameWidth }),
      ...(allowlist === undefined
        ? {}
        : { eventsAllowlist: allowlist.split(' ').filter(Boolean) as EmbedEventName[] }),
      onLoad: () => {
        update({ status: 'loaded' });
        handlers.current.onLoad?.();
      },
      onReady: () => {
        update({ status: 'ready' });
        handlers.current.onReady?.();
      },
      onEvent: (event) => {
        update({ lastEvent: event });
        handlers.current.onEvent?.(event);
      },
      onComplete: (result) => {
        update({ status: 'complete', completion: result });
        handlers.current.onComplete?.(result);
      },
      onCancel: (result) => {
        update({ status: 'cancelled' });
        handlers.current.onCancel?.(result);
      },
      onError: (error) => {
        update({ status: 'error', error });
        handlers.current.onError?.(error);
      },
    };
    const handle = embed(frameOptions);
    return () => {
      mounted = false;
      handle.destroy();
    };
  }, [
    element,
    key,
    flowUrl,
    inquiryId,
    sessionToken,
    oneTimeLink,
    language,
    styleVariant,
    iframeTitle,
    frameHeight,
    frameWidth,
    allowlist,
  ]);

  return {
    ref: setElement,
    state: keyed?.key === key ? keyed.state : INITIAL_OPEN_VERIFY_STATE,
  };
}
