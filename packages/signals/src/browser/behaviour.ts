/**
 * One screen's behaviour aggregates (plan C94.3), reduced as events arrive. Pure: it sees only the
 * few event facts the collector extracts ({@link ObservedEvent}) and the time, never a key, a
 * per-key timing, a value or a coordinate. Typing cadence keeps three running sums, never the
 * intervals themselves.
 */
import { COLLECTOR_CUTOFFS, MAX_COUNT } from './constants.js';
import type { BehaviourSignals, PointerBeforeClick, PointerType } from './types.js';

/** The pointer types the contract names, in its order (contracts `POINTER_TYPES`). */
const POINTER_TYPES: readonly PointerType[] = ['mouse', 'pen', 'touch'];
/** The events whose `isTrusted: false` counts as scripted input (C94.8: on inputs). */
const UNTRUSTED_TYPES = ['keydown', 'input', 'pointerdown', 'click'];

// Indexes of the screen's counters.
const PASTE = 0;
const DROP = 1;
const AUTOFILL = 2;
const CORRECTION = 3;
const FOCUS_LOSS = 4;
const HIDDEN = 5;
const INPUT_EVENTS = 6;
const UNTRUSTED = 7;

/** The facts of one DOM event the aggregate needs; nothing else is ever read from an event. */
export interface ObservedEvent {
  /** `keydown`, `input`, `pointerdown`, `pointermove`, `click`, `blur` or `visibilitychange`. */
  readonly type: string;
  /** `Event.isTrusted`: `false` when the page's own script made the event. */
  readonly trusted: boolean;
  /** An `input` event's `inputType` (`insertFromPaste`, `deleteContentBackward`, ...). */
  readonly inputType?: string | undefined;
  /** A pointer event's `pointerType`. */
  readonly pointerType?: string | undefined;
  /** A `keydown`'s `repeat` (a held key). */
  readonly repeat?: boolean | undefined;
  /** A `click`'s `detail`: 0 for a keyboard or scripted click. */
  readonly detail?: number | undefined;
  /** An `input` event whose target matches `:autofill`. */
  readonly autofill?: boolean | undefined;
  /** A `visibilitychange` to `hidden`. */
  readonly hidden?: boolean | undefined;
}

/** What a closed screen yields: its aggregates, and its untrusted events for `integrity`. */
export interface ClosedScreen {
  readonly behaviour: BehaviourSignals;
  readonly untrustedEvents: number;
}

export interface ScreenAggregate {
  observe(event: ObservedEvent, now: number): void;
  close(now: number): ClosedScreen;
}

/**
 * Opens one screen's aggregate at `opened` (milliseconds on a monotonic clock), `hidden` when the
 * document is hidden at that moment.
 */
export function openScreen(opened: number, hidden: boolean): ScreenAggregate {
  const counts = [0, 0, 0, 0, 0, 0, 0, 0];
  let hiddenSince: number | null = hidden ? opened : null;
  let hiddenTime = 0;
  let firstInput: number | null = null;
  let lastKey: number | null = null;
  // Typing cadence: the number, sum and sum of squares of the keydown intervals, never the list.
  let intervals = 0;
  let sum = 0;
  let squares = 0;
  let moved = false;
  let beforeClick: PointerBeforeClick = 'n/a';
  const pointers = new Set<string>();

  const add = (index: number) => {
    counts[index] = Math.min(MAX_COUNT, (counts[index] ?? 0) + 1);
  };
  const seconds = (milliseconds: number) =>
    Math.min(COLLECTOR_CUTOFFS.dwellCapSeconds, Math.round(milliseconds / 1000));

  return {
    observe(event, now) {
      const { type, inputType } = event;
      if (!event.trusted && UNTRUSTED_TYPES.includes(type)) {
        add(UNTRUSTED);
      }
      if (type === 'blur') {
        add(FOCUS_LOSS);
      } else if (type === 'visibilitychange') {
        if (event.hidden && hiddenSince === null) {
          add(HIDDEN);
          hiddenSince = now;
        } else if (!event.hidden && hiddenSince !== null) {
          hiddenTime += now - hiddenSince;
          hiddenSince = null;
        }
      } else if (type === 'pointermove' || type === 'pointerdown') {
        if (POINTER_TYPES.includes(event.pointerType as PointerType)) {
          pointers.add(event.pointerType as PointerType);
        }
        moved ||= type === 'pointermove';
      } else if (type === 'click' && event.detail && beforeClick === 'n/a') {
        beforeClick = moved ? 'true' : 'false';
      }

      // Inserted text (pasted, dropped, autofilled) is input of its own; typed text is its keydown.
      const inserted =
        type === 'input' &&
        (event.autofill === true ||
          /^insert(?:FromPaste|FromDrop|ReplacementText)$/.test(inputType ?? ''));
      if (type === 'keydown' || type === 'pointerdown' || inserted) {
        add(INPUT_EVENTS);
      }
      if (type === 'keydown' || type === 'pointerdown' || type === 'input') {
        firstInput ??= now;
      }
      if (type === 'input') {
        if (inputType === 'insertFromPaste') {
          add(PASTE);
        } else if (inputType === 'insertFromDrop') {
          add(DROP);
        } else if (inputType === 'insertReplacementText' || event.autofill) {
          add(AUTOFILL);
        } else if (/^(?:delete|historyUndo)/.test(inputType ?? '')) {
          add(CORRECTION);
        }
      }
      if (type === 'keydown' && !event.repeat) {
        if (lastKey !== null) {
          const interval = now - lastKey;
          intervals += 1;
          sum += interval;
          squares += interval * interval;
        }
        lastKey = now;
      }
    },

    close(now) {
      const hiddenTotal = hiddenTime + (hiddenSince === null ? 0 : now - hiddenSince);
      const [fast, quick, slow] = COLLECTOR_CUTOFFS.firstInputEdges;
      const delay = firstInput === null ? null : (firstInput - opened) / 1000;
      const mean = intervals > 0 ? sum / intervals : 0;
      const deviation = Math.sqrt(Math.max(0, squares / Math.max(1, intervals) - mean * mean));
      const count = (index: number) => counts[index] ?? 0;
      return {
        behaviour: {
          'paste-count': count(PASTE),
          'drop-count': count(DROP),
          'autofill-count': count(AUTOFILL),
          'correction-count': count(CORRECTION),
          'focus-loss-count': count(FOCUS_LOSS),
          'hidden-count': count(HIDDEN),
          'input-event-count': count(INPUT_EVENTS),
          'dwell-seconds': seconds(now - opened),
          'hidden-seconds': seconds(hiddenTotal),
          'first-input-bucket':
            delay === null
              ? 'none'
              : delay < fast
                ? '<0.25s'
                : delay < quick
                  ? '0.25-1s'
                  : delay < slow
                    ? '1-5s'
                    : '>5s',
          'typing-cadence':
            intervals < COLLECTOR_CUTOFFS.minIntervals
              ? 'insufficient'
              : mean === 0 || deviation / mean < COLLECTOR_CUTOFFS.uniformCv
                ? 'uniform'
                : 'variable',
          'pointer-types': POINTER_TYPES.filter((pointer) => pointers.has(pointer)),
          'pointer-before-click': beforeClick,
        },
        untrustedEvents: count(UNTRUSTED),
      };
    },
  };
}
