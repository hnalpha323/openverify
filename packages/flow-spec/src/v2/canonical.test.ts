import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalFlowJson, canonicalJson } from './graph.js';
import { branch, completion, consent, flowOf, route, v } from './test-flows.js';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('canonicalJson (RFC 8785)', () => {
  it('sorts members by UTF-16 code units at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: null }, A: true })).toBe(
      '{"A":true,"a":{"c":null,"d":[3,1,2]},"b":1}',
    );
    // U+20AC sorts after U+00E9 and U+0080, and a surrogate pair by its code units.
    const keys = { '\u20ac': 1, '\u00e9': 2, '\u0080': 3, '\ud83d\ude00': 4, '1': 5, '\r': 6 };
    expect(canonicalJson(keys)).toBe(
      `{"\\r":6,"1":5,"\u0080":3,"\u00e9":2,"\u20ac":1,"\ud83d\ude00":4}`,
    );
  });

  it('writes numbers as ECMAScript does (the RFC 8785 sample)', () => {
    expect(
      canonicalJson([Number('333333333.33333329'), 1e30, 4.5, 2e-3, 1e-27, -0, 10, -1.5]),
    ).toBe('[333333333.3333333,1e+30,4.5,0.002,1e-27,0,10,-1.5]');
  });

  it('escapes strings as JSON.stringify does, with lower-case \\u escapes', () => {
    expect(canonicalJson('\u20ac$\u000f\nA\'B"\\/')).toBe('"€$\\u000f\\nA\'B\\"\\\\/"');
    expect(canonicalJson(['\u001f', '\t', '\b', '\f'])).toBe('["\\u001f","\\t","\\b","\\f"]');
  });

  it('drops undefined members, as JSON does, and refuses what JSON cannot hold', () => {
    expect(canonicalJson({ a: undefined, b: [1] })).toBe('{"b":[1]}');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => canonicalJson({ a: 1n })).toThrow(TypeError);
    expect(() => canonicalJson([() => 1])).toThrow(TypeError);
  });
});

describe('canonicalFlowJson (C147.7)', () => {
  const flow = flowOf(
    [
      consent(),
      branch('route_it', [route('late', { '>': [v('inquiry.created-at'), 1.5e3] }, 'else')]),
      completion(),
    ],
    [
      ['consent', 'next', 'route_it'],
      ['route_it', 'route:late', 'done'],
      ['route_it', 'else', 'done'],
    ],
  );

  it('is the canonical JSON of everything but layout', () => {
    const laidOut = { ...flow, layout: { consent: { x: 10, y: 20 }, done: { x: 0, y: 1 } } };
    expect(canonicalFlowJson(laidOut)).toBe(canonicalFlowJson(flow));
    expect(canonicalFlowJson(flow)).not.toContain('layout');
    expect(canonicalFlowJson(flow).startsWith('{"edges":[{"from":"consent","id":"e1"')).toBe(true);
  });

  it('gives one flow-sha256 whatever the member order it was written in', () => {
    const reordered = JSON.parse(
      JSON.stringify({
        steps: flow.steps,
        edges: flow.edges,
        entry: flow.entry,
        metadata: flow.metadata,
      }),
    ) as typeof flow;
    expect(sha256(canonicalFlowJson(reordered))).toBe(sha256(canonicalFlowJson(flow)));
    expect(sha256(canonicalFlowJson(flow))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with anything but layout', () => {
    const renamed = { ...flow, metadata: { ...flow.metadata, name: 'Other' } };
    expect(canonicalFlowJson(renamed)).not.toBe(canonicalFlowJson(flow));
  });
});
