import { describe, expect, it } from 'vitest';
import { openScreen, type ObservedEvent } from './behaviour.js';

const T0 = 10_000;
const event = (type: string, facts: Partial<ObservedEvent> = {}): ObservedEvent => ({
  type,
  trusted: true,
  ...facts,
});

/** Feeds `events` at the given offsets (ms from T0) and closes the screen at `closeAt`. */
function screenOf(events: readonly (readonly [number, ObservedEvent])[], closeAt = 60_000) {
  const screen = openScreen(T0, false);
  for (const [at, item] of events) {
    screen.observe(item, T0 + at);
  }
  return screen.close(T0 + closeAt);
}

describe('one screen of behaviour aggregates (C94.3)', () => {
  it('counts pastes, drops, autofills, corrections, focus losses and hidden periods', () => {
    const { behaviour } = screenOf([
      [100, event('input', { inputType: 'insertFromPaste' })],
      [200, event('input', { inputType: 'insertFromPaste' })],
      [300, event('input', { inputType: 'insertFromDrop' })],
      [400, event('input', { inputType: 'insertReplacementText' })],
      [500, event('input', { inputType: 'insertText', autofill: true })],
      [600, event('input', { inputType: 'deleteContentBackward' })],
      [700, event('input', { inputType: 'deleteWordBackward' })],
      [800, event('input', { inputType: 'deleteByCut' })],
      [900, event('input', { inputType: 'historyUndo' })],
      [1_000, event('input', { inputType: 'insertText' })],
      [1_100, event('blur')],
      [1_200, event('visibilitychange', { hidden: true })],
      [1_300, event('visibilitychange', { hidden: false })],
    ]);
    expect(behaviour).toMatchObject({
      'paste-count': 2,
      'drop-count': 1,
      'autofill-count': 2,
      'correction-count': 4,
      'focus-loss-count': 1,
      'hidden-count': 1,
    });
  });

  it('counts keydowns, pointer presses and inserted (not typed) input as input events', () => {
    const { behaviour } = screenOf([
      [100, event('keydown')],
      [200, event('input', { inputType: 'insertText' })],
      [300, event('keydown')],
      [400, event('input', { inputType: 'insertText' })],
      [500, event('keydown', { repeat: true })],
      [600, event('pointerdown', { pointerType: 'mouse' })],
      [700, event('pointermove', { pointerType: 'mouse' })],
      [800, event('click', { detail: 1 })],
      [900, event('input', { inputType: 'insertFromPaste' })],
      [950, event('input', { inputType: 'insertText', autofill: true })],
    ]);
    // 3 keydowns (a held key included), 1 pointerdown, 1 paste, 1 autofill.
    expect(behaviour['input-event-count']).toBe(6);
  });

  it('counts scripted (untrusted) input, key, pointer and click events apart, for integrity', () => {
    const { untrustedEvents, behaviour } = screenOf([
      [100, event('keydown', { trusted: false })],
      [200, event('input', { trusted: false, inputType: 'insertText' })],
      [300, event('pointerdown', { trusted: false, pointerType: 'mouse' })],
      [400, event('click', { trusted: false, detail: 0 })],
      [500, event('blur', { trusted: false })],
      [600, event('keydown')],
    ]);
    expect(untrustedEvents).toBe(4);
    expect(behaviour['focus-loss-count']).toBe(1);
  });

  it('gives dwell and hidden time in whole seconds, each capped at 3,600', () => {
    expect(screenOf([], 12_400).behaviour['dwell-seconds']).toBe(12);
    expect(screenOf([], 12_600).behaviour['dwell-seconds']).toBe(13);
    expect(screenOf([], 5 * 3_600_000).behaviour['dwell-seconds']).toBe(3600);

    const hiddenTwice = screenOf(
      [
        [1_000, event('visibilitychange', { hidden: true })],
        [4_000, event('visibilitychange', { hidden: false })],
        [10_000, event('visibilitychange', { hidden: true })],
        [10_000, event('visibilitychange', { hidden: true })],
      ],
      12_500,
    ).behaviour;
    // 3 s, then 2.5 s still hidden when the screen closes; a repeated "hidden" is one period.
    expect(hiddenTwice['hidden-seconds']).toBe(6);
    expect(hiddenTwice['hidden-count']).toBe(2);

    const openedHidden = openScreen(T0, true);
    openedHidden.observe(event('visibilitychange', { hidden: false }), T0 + 4_000);
    expect(openedHidden.close(T0 + 9_000).behaviour['hidden-seconds']).toBe(4);
    expect(
      screenOf([[0, event('visibilitychange', { hidden: true })]], 5 * 3_600_000).behaviour[
        'hidden-seconds'
      ],
    ).toBe(3600);
  });

  it('buckets the first input by the fixed edges 0.25, 1 and 5 seconds', () => {
    const bucket = (at: number, type = 'keydown') =>
      screenOf([[at, event(type, { pointerType: 'touch' })]]).behaviour['first-input-bucket'];
    expect(bucket(0)).toBe('<0.25s');
    expect(bucket(249)).toBe('<0.25s');
    expect(bucket(250)).toBe('0.25-1s');
    expect(bucket(999, 'pointerdown')).toBe('0.25-1s');
    expect(bucket(1_000)).toBe('1-5s');
    expect(bucket(4_999)).toBe('1-5s');
    expect(bucket(5_000)).toBe('>5s');
    expect(screenOf([]).behaviour['first-input-bucket']).toBe('none');
    // Moving the pointer is not input.
    expect(bucket(100, 'pointermove')).toBe('none');
  });

  it('classes typing cadence from at least 8 keydown intervals by their coefficient of variation', () => {
    const typed = (intervals: readonly number[], repeat = false) => {
      let at = 0;
      const events: [number, ObservedEvent][] = [[at, event('keydown', { repeat })]];
      for (const interval of intervals) {
        at += interval;
        events.push([at, event('keydown', { repeat })]);
      }
      return screenOf(events, at + 1_000).behaviour['typing-cadence'];
    };
    expect(typed([100, 100, 100, 100, 100, 100, 100])).toBe('insufficient');
    expect(typed([100, 100, 100, 100, 100, 100, 100, 100])).toBe('uniform');
    // Mean 100 ms, standard deviation 9 ms: a coefficient of 0.09, below the 0.1 cut-off.
    expect(typed([91, 109, 91, 109, 91, 109, 91, 109])).toBe('uniform');
    // Standard deviation 10 ms: exactly 0.1 is not below the cut-off.
    expect(typed([90, 110, 90, 110, 90, 110, 90, 110])).toBe('variable');
    expect(typed([80, 240, 130, 410, 95, 180, 300, 150])).toBe('variable');
    // Keys pressed at the same instant are mechanical.
    expect(typed([0, 0, 0, 0, 0, 0, 0, 0])).toBe('uniform');
    // A held key's repeats are not typing.
    expect(typed([30, 30, 30, 30, 30, 30, 30, 30], true)).toBe('insufficient');
  });

  it('reports the pointer types seen, in a fixed order, and ignores unknown ones', () => {
    const types = (...seen: [string, string][]) =>
      screenOf(seen.map(([type, pointerType], index) => [index * 10, event(type, { pointerType })]))
        .behaviour['pointer-types'];
    expect(types(['pointerdown', 'touch'], ['pointermove', 'mouse'])).toEqual(['mouse', 'touch']);
    expect(types(['pointermove', 'pen'], ['pointerdown', 'pen'], ['pointerdown', 'eye'])).toEqual([
      'pen',
    ]);
    expect(types()).toEqual([]);
  });

  it('says whether the pointer moved before the first pointer click on the screen', () => {
    const before = (...events: ObservedEvent[]) =>
      screenOf(events.map((item, index) => [index * 10, item])).behaviour['pointer-before-click'];
    expect(before()).toBe('n/a');
    expect(
      before(event('pointermove', { pointerType: 'mouse' }), event('click', { detail: 1 })),
    ).toBe('true');
    expect(before(event('click', { detail: 1 }))).toBe('false');
    // The first click decides; a keyboard or scripted click (detail 0) is not a pointer click.
    expect(
      before(
        event('click', { detail: 1 }),
        event('pointermove', { pointerType: 'mouse' }),
        event('click', { detail: 1 }),
      ),
    ).toBe('false');
    expect(before(event('click', { detail: 0 }))).toBe('n/a');
  });

  it('caps every count at 10,000', () => {
    const screen = openScreen(T0, false);
    for (let index = 0; index < 10_050; index += 1) {
      screen.observe(event('input', { inputType: 'insertFromPaste', trusted: false }), T0 + index);
    }
    const closed = screen.close(T0 + 20_000);
    expect(closed.behaviour['paste-count']).toBe(10_000);
    expect(closed.behaviour['input-event-count']).toBe(10_000);
    expect(closed.untrustedEvents).toBe(10_000);
  });

  it('yields exactly the thirteen behaviour members, and nothing per key or per event', () => {
    const { behaviour } = screenOf([
      [100, event('keydown')],
      [200, event('keydown')],
    ]);
    expect(Object.keys(behaviour).sort()).toEqual(
      [
        'autofill-count',
        'correction-count',
        'drop-count',
        'dwell-seconds',
        'first-input-bucket',
        'focus-loss-count',
        'hidden-count',
        'hidden-seconds',
        'input-event-count',
        'paste-count',
        'pointer-before-click',
        'pointer-types',
        'typing-cadence',
      ].sort(),
    );
  });
});
