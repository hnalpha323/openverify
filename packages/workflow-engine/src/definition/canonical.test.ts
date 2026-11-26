/** C113.7: the hash is SHA-256 of RFC 8785 canonical JSON of everything but `layout`. */
import { createHash } from 'node:crypto';
import type { WorkflowDefinition } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { canonicalJson, definitionSha256 } from './canonical.js';
import { readWorkflowFixture } from './testing.js';

const everyNode = readWorkflowFixture('definition-every-node.json') as WorkflowDefinition;

describe('canonicalJson (RFC 8785)', () => {
  it('orders keys by UTF-16 code units, as the RFC example does', () => {
    // RFC 8785 section 3.2.3: code-unit order puts U+1F600 (a surrogate pair) before U+FB33.
    expect(
      canonicalJson({
        '€': 'Euro Sign',
        '\r': 'Carriage Return',
        דּ: 'Hebrew Letter Dalet With Dagesh',
        '1': 'One',
        '😀': 'Emoji: Grinning Face',
        '\u0080': 'Control',
        ö: 'Latin Small Letter O With Diaeresis',
      }),
    ).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  it('writes numbers as ECMAScript does, with no exponent games', () => {
    expect(canonicalJson([1, 1.5, 0.1, 1e21, 1e-7, -0, 100])).toBe('[1,1.5,0.1,1e+21,1e-7,0,100]');
  });

  it('writes the RFC section 3.2.2.2 string with its minimal escapes', () => {
    const text = `€$\u000f\nA'B"\\"/`;
    expect(canonicalJson(text)).toBe('"€$\\u000f\\nA\'B\\"\\\\\\"/"');
  });

  it('writes nulls, booleans and nested members', () => {
    expect(canonicalJson({ b: [true, null, { z: 1, a: 2 }], a: false })).toBe(
      '{"a":false,"b":[true,null,{"a":2,"z":1}]}',
    );
  });

  it('gives the same text however the keys were written', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [undefined], [() => 1], [1n]])(
    'refuses %s, which is no JSON value',
    (value) => {
      expect(() => canonicalJson(value)).toThrow(TypeError);
      expect(() => canonicalJson({ a: value })).toThrow(TypeError);
    },
  );
});

describe('definitionSha256 (C113.7)', () => {
  it('is the SHA-256 of the canonical JSON without the layout', () => {
    const hashed = Object.fromEntries(
      Object.entries(everyNode).filter(([member]) => member !== 'layout'),
    );
    expect(definitionSha256(everyNode)).toBe(
      createHash('sha256').update(canonicalJson(hashed), 'utf8').digest('hex'),
    );
  });

  it('is 64 lower-case hex characters', () => {
    expect(definitionSha256(everyNode)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores the layout, so moving a node changes no version', () => {
    expect(definitionSha256({ ...everyNode, layout: { trigger: { x: 9, y: 9 } } })).toBe(
      definitionSha256(everyNode),
    );
  });

  it('changes with anything else', () => {
    expect(definitionSha256({ ...everyNode, variables: [] })).not.toBe(definitionSha256(everyNode));
  });

  it('does not depend on the order keys were written in', () => {
    const reordered = Object.fromEntries(Object.entries(everyNode).reverse());
    expect(definitionSha256(reordered as WorkflowDefinition)).toBe(definitionSha256(everyNode));
  });
});
