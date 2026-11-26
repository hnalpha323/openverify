/**
 * The browser collector (plan C94.3, C94.4, C94.6, P14). It instantiates nothing until the session
 * reports consent and its tiers: with `tiers: null` it attaches no listener and reads no browser
 * API. Under `integrity` it listens (capture, passive) for the few events the aggregates need and
 * sends one body per screen when the screen closes; under `recognition` it reads the device
 * components once and sends them in their own body. It makes no request itself (the flow's `send`
 * posts each body), uses no storage, frame, worker or remote code, and swallows its own failures.
 */
import { openScreen, type ScreenAggregate } from './behaviour.js';
import { COLLECTOR_VERSION } from './constants.js';
import { readIntegrity } from './integrity.js';
import { probe } from './probe.js';
import { readRecognition } from './recognition.js';
import type { BrowserWindow, CollectorTiers, RecognitionSignals, WebSignalsBody } from './types.js';

export interface CollectorOptions {
  /** The session's tiers from `GET /api/v1/flow/session`, or `null` while it may not collect. */
  readonly tiers: CollectorTiers | null;
  /** Posts one body to `POST /api/v1/flow/signals`; a rejection is swallowed. */
  readonly send: (body: WebSignalsBody) => Promise<void> | void;
  /** The window to read; `window` in a page. */
  readonly window?: BrowserWindow;
  /** The first body's `sequence` (default 0); each body takes the next. */
  readonly firstSequence?: number;
}

export interface Collector {
  /** Whether the session may collect (a tier is on). */
  readonly collecting: boolean;
  /** The flow shows step `stepId`: the previous screen closes and its body is sent. */
  screen(stepId: string): void;
  /** Closes the current screen, sends its body, and settles once every body sent so far has. */
  flush(): Promise<void>;
  /** Closes the current screen (sending its body) and removes every listener; idempotent. */
  stop(): void;
}

/** The document events the aggregates need, listened to in the capture phase. */
const DOCUMENT_EVENTS = [
  'keydown',
  'input',
  'pointerdown',
  'pointermove',
  'click',
  'visibilitychange',
];
const CAPTURE = { capture: true, passive: true };
/**
 * The window's own `blur` (it lost focus). Not in the capture phase, where every field's blur
 * would pass through the window too.
 */
const OWN = { passive: true };

const settle = () => undefined;

/** Whether an `input` event's target was filled by the browser's autofill (C94.3). */
function autofilled(target: EventTarget | null): boolean {
  const element = target as Element;
  return probe(
    () => element.matches(':autofill'),
    probe(() => element.matches(':-webkit-autofill'), false),
  );
}

/**
 * Starts collection for one session. With `tiers: null`, or both tiers off, it returns a handle
 * that reads, listens to and sends nothing.
 */
export function startCollector(options: CollectorOptions): Collector {
  const { tiers, send } = options;
  const integrity = tiers?.integrity === true;
  const recognition = tiers?.recognition === true;
  const collecting = integrity || recognition;
  const inflight = new Set<Promise<void>>();
  const removers: (() => void)[] = [];
  let sequence = options.firstSequence ?? 0;
  let stopped = !collecting;
  let recognitionStarted = false;
  /** Recognition components read but not yet delivered: the next body carries them. */
  let components: RecognitionSignals | undefined;
  let current: { readonly id: string; readonly aggregate: ScreenAggregate } | null = null;
  let win = undefined as unknown as BrowserWindow;

  const now = () => win.performance.now();

  /** Sends one body; a failure is swallowed, and gives back the components it carried. */
  const dispatch = (body: WebSignalsBody): Promise<void> => {
    const carried = body.recognition;
    const sent = Promise.resolve(body)
      .then(send)
      .then(settle, () => {
        components ??= carried;
      });
    inflight.add(sent);
    void sent.then(() => inflight.delete(sent));
    return sent;
  };

  const head = (screen: string, at = sequence++): WebSignalsBody => ({
    platform: 'web',
    'collector-version': COLLECTOR_VERSION,
    screen,
    sequence: at,
  });

  /** Closes the open screen and sends its aggregates with the integrity artefacts. */
  const close = () => {
    const closing = current;
    current = null;
    if (closing === null) {
      return;
    }
    try {
      const { behaviour, untrustedEvents } = closing.aggregate.close(now());
      const body = head(closing.id);
      body.integrity = readIntegrity(win, untrustedEvents);
      body.behaviour = behaviour;
      if (components !== undefined) {
        body.recognition = components;
        components = undefined;
      }
      void dispatch(body);
    } catch {
      // A collector failure never reaches the person; the server reads the gap as missing data.
    }
  };

  const listener = (event: Event) => {
    const screen = current;
    if (screen === null) {
      return;
    }
    try {
      const facts = event as Event & {
        inputType?: string;
        pointerType?: string;
        repeat?: boolean;
        detail?: number;
      };
      const type = facts.type;
      screen.aggregate.observe(
        {
          type,
          trusted: facts.isTrusted,
          inputType: facts.inputType,
          pointerType: facts.pointerType,
          repeat: facts.repeat,
          detail: facts.detail,
          autofill: type === 'input' && autofilled(facts.target),
          hidden: type === 'visibilitychange' && win.document.visibilityState === 'hidden',
        },
        now(),
      );
    } catch {
      // As above: swallowed.
    }
  };

  if (collecting) {
    win = options.window ?? (globalThis as BrowserWindow);
  }
  if (integrity) {
    const doc = win.document;
    for (const type of DOCUMENT_EVENTS) {
      doc.addEventListener(type, listener, CAPTURE);
      removers.push(() => {
        doc.removeEventListener(type, listener, true);
      });
    }
    win.addEventListener('blur', listener, OWN);
    removers.push(() => {
      win.removeEventListener('blur', listener);
    });
  }

  return {
    collecting,
    screen(stepId) {
      if (stopped) {
        return;
      }
      if (recognition && !recognitionStarted) {
        // Its own body, numbered now; it carries the components once their digest is computed.
        recognitionStarted = true;
        const body = head(stepId);
        const read = readRecognition(win).then((read) => {
          body.recognition = read;
          return dispatch(body);
        });
        inflight.add(read);
        void read.then(() => inflight.delete(read));
      } else if (!integrity && components !== undefined) {
        // No screen body will carry components whose send failed: they go again on their own.
        const body = head(stepId);
        body.recognition = components;
        components = undefined;
        void dispatch(body);
      }
      if (integrity && current?.id !== stepId) {
        close();
        current = {
          id: stepId,
          aggregate: openScreen(now(), win.document.visibilityState === 'hidden'),
        };
      }
    },
    flush() {
      close();
      return Promise.all(inflight).then(settle);
    },
    stop() {
      if (!stopped) {
        close();
        stopped = true;
        for (const remove of removers.splice(0)) {
          remove();
        }
      }
    },
  };
}
