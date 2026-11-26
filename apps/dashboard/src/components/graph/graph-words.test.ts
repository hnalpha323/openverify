import {
  GRAPH_BULK_ACTIONS,
  GRAPH_BULK_OUTCOMES,
  GRAPH_KINDS,
  GRAPH_PROBLEM_CODES,
  GRAPH_QUERY_STATUSES,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  GRAPH_ACTION_WORDS,
  GRAPH_NODE_STYLES,
  GRAPH_OUTCOME_WORDS,
  GRAPH_PROBLEM_WORDS,
  GRAPH_STATUS_WORDS,
  describeGraphProblem,
  graphKindLabel,
  graphTemplateProblemWords,
  truncationSentences,
} from './graph-words';

describe('graph words (C108)', () => {
  it('names every kind, and draws each node type with its own shape and colour, so no kind is told by colour alone (WCAG 1.4.1)', () => {
    const types = ['account', ...GRAPH_KINDS] as const;
    for (const type of types) {
      expect(graphKindLabel(type)).toMatch(/^[A-Z]/);
      expect(GRAPH_NODE_STYLES[type].shape).not.toBe('');
      expect(GRAPH_NODE_STYLES[type].shapeName).not.toBe('');
    }
    const shapes = new Set(types.map((type) => GRAPH_NODE_STYLES[type].shape));
    expect(shapes.size).toBe(types.length);
    expect(graphKindLabel('email_address')).toBe('Email address (confirmed)');
    expect(graphKindLabel('email_address_unconfirmed')).toBe('Email address (unconfirmed)');
    expect(graphKindLabel('account')).toBe('Account');
  });

  it('gives every node colour at least 3:1 against the canvas background (WCAG 1.4.11)', () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((at) => {
        const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
        return channel <= 0.039_28 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (high + 0.05) / (low + 0.05);
    };
    for (const type of ['account', ...GRAPH_KINDS] as const) {
      expect(contrast(GRAPH_NODE_STYLES[type].colour, '#ffffff')).toBeGreaterThanOrEqual(3);
    }
  });

  it('says every query status in words', () => {
    for (const status of GRAPH_QUERY_STATUSES) {
      expect(GRAPH_STATUS_WORDS[status].label).not.toBe('');
      expect(GRAPH_STATUS_WORDS[status].description).not.toBe('');
    }
    expect(GRAPH_STATUS_WORDS.timed_out.description).toMatch(/what it gathered/);
  });

  it('says every problem code and every bulk outcome in words, never passing or failing anyone', () => {
    for (const code of GRAPH_PROBLEM_CODES) {
      expect(GRAPH_PROBLEM_WORDS[code]).toMatch(/\.$/);
    }
    for (const outcome of GRAPH_BULK_OUTCOMES) {
      expect(GRAPH_OUTCOME_WORDS[outcome]).not.toBe('');
    }
    for (const action of GRAPH_BULK_ACTIONS) {
      expect(GRAPH_ACTION_WORDS[action]).not.toBe('');
    }
    const all = [...Object.values(GRAPH_PROBLEM_WORDS), ...Object.values(GRAPH_OUTCOME_WORDS)].join(
      ' ',
    );
    expect(all).not.toMatch(/\b(passed|failed|declined|safe|clean)\b/i);
  });

  it('titles a graph problem with its words and keeps the API detail, pointer and request id', () => {
    expect(
      describeGraphProblem({
        title: 'Too Many Requests',
        status: 429,
        code: 'graph_sync_limited',
        detail: 'Synthetic detail.',
        requestId: 'req-1',
        errors: [{ pointer: '/data/attributes', detail: 'x' }],
      }),
    ).toEqual({
      title: GRAPH_PROBLEM_WORDS.graph_sync_limited,
      status: 429,
      code: 'graph_sync_limited',
      detail: 'Synthetic detail.',
      requestId: 'req-1',
      errors: [{ pointer: '/data/attributes', detail: 'x' }],
    });
    const codeless = { title: 'Unprocessable Content', status: 422, detail: 'not a name' };
    expect(describeGraphProblem(codeless)).toEqual(codeless);
    const rateLimited = describeGraphProblem({ title: 'Too Many Requests', status: 429 });
    expect(rateLimited.title).toMatch(/too many/i);
  });

  it('names the template publish refusals in words', () => {
    expect(graphTemplateProblemWords('weak_kind_not_allowed')).toMatch(/weak/);
    expect(graphTemplateProblemWords('graph_parameter_unbound')).toMatch(/parameter/);
  });

  it('says what the caps cut and what the index lacks, in words', () => {
    expect(
      truncationSentences({
        'node-limit-reached': true,
        'skipped-hub-values': 3,
        'index-complete': false,
        'kinds-not-indexed': ['device_fingerprint', 'ip_address'],
        nodeLimit: 100,
      }),
    ).toEqual([
      'The index is still being built: device fingerprint (Android ID) and IP address are not indexed for this query, so links through them may be missing.',
      'The search stopped at the node limit (100 nodes): more may be linked beyond what is shown.',
      '3 shared values were skipped because more than the fan-out cap of accounts hold each one.',
    ]);
    expect(
      truncationSentences({
        'node-limit-reached': false,
        'skipped-hub-values': 1,
        'index-complete': true,
        'kinds-not-indexed': [],
        nodeLimit: null,
      }),
    ).toEqual([
      '1 shared value was skipped because more than the fan-out cap of accounts hold it.',
    ]);
    expect(
      truncationSentences({
        'node-limit-reached': false,
        'skipped-hub-values': 0,
        'index-complete': true,
        'kinds-not-indexed': [],
        nodeLimit: null,
      }),
    ).toEqual([]);
  });
});
