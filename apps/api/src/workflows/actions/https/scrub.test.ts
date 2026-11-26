/**
 * C125.5: before anything is stored, every occurrence of each value resolved in a step, and of its
 * base64, base64url and percent-encoded forms, reads `[REDACTED]`. Every value is a synthetic canary.
 */
import { describe, expect, it } from 'vitest';
import { REDACTED, createScrubber } from './scrub.js';

const CANARY = 'canary/secret+value?=synthetic';
const base64 = Buffer.from(CANARY).toString('base64');
const base64url = Buffer.from(CANARY).toString('base64url');

describe('createScrubber', () => {
  it.each([
    ['as written', CANARY],
    ['in base64', base64],
    ['in base64 with no padding', base64.replace(/={1,2}$/, '')],
    ['in base64url', base64url],
    ['percent-encoded', encodeURIComponent(CANARY)],
    ['form-encoded', new URLSearchParams({ a: CANARY }).toString().slice(2)],
  ])('removes a value %s', (_name, form) => {
    const { text } = createScrubber([CANARY]);

    expect(text(`before ${form} after ${form}`)).toBe(`before ${REDACTED} after ${REDACTED}`);
  });

  it('leaves other text', () => {
    expect(createScrubber([CANARY]).text('nothing here')).toBe('nothing here');
  });

  it('takes the longest form first, so a shorter value leaves no tail', () => {
    const { text } = createScrubber(['canary', 'canary-long-value']);

    expect(text('x canary-long-value y')).toBe(`x ${REDACTED} y`);
  });

  it('reads every member of a JSON value, keys included', () => {
    const { json } = createScrubber([CANARY]);

    expect(
      json({ [CANARY]: 1, list: [`a ${CANARY}`, 2, null, { deep: base64 }], flag: true }),
    ).toEqual({ [REDACTED]: 1, list: [`a ${REDACTED}`, 2, null, { deep: REDACTED }], flag: true });
  });

  it('ignores an empty value, which would match everywhere', () => {
    expect(createScrubber(['']).text('text')).toBe('text');
  });

  it('holds a member named __proto__ as a member', () => {
    const { json } = createScrubber([CANARY]);
    const input = JSON.parse('{"__proto__": "x"}') as Record<string, string>;

    expect(Object.keys(json(input) as object)).toEqual(['__proto__']);
  });
});
