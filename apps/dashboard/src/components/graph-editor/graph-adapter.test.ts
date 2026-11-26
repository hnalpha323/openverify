import { describe, expect, it } from 'vitest';
import { issuesUnder, scopePathsSchema, type ScopePath } from './graph-adapter';
import { LINE, LINE_ADAPTER } from './test-adapter';

const path = (overrides: Partial<ScopePath> & { path: string }): ScopePath => ({
  type: 'string',
  options: [],
  nullable: false,
  pii: false,
  source: 'Synthetic',
  ...overrides,
});

describe('issuesUnder (C113.6)', () => {
  it('keeps the problems at a pointer or inside it, never a sibling that shares a prefix', () => {
    const issues = [
      { pointer: '/nodes/1', detail: 'cannot be reached' },
      { pointer: '/nodes/1/config/text', detail: 'is required' },
      { pointer: '/nodes/10', detail: 'another node' },
      { pointer: '', detail: 'the whole document' },
    ];

    expect(issuesUnder(issues, '/nodes/1')).toEqual(['cannot be reached', 'is required']);
  });
});

describe('scopePathsSchema (C115.3, C150.2)', () => {
  it('nests each path under its roots, typed, nullable where the fact can be unknown', () => {
    const schema = scopePathsSchema([
      path({ path: 'inquiry.status', type: 'enum', options: ['created', 'pending'] }),
      path({ path: 'verifications.s_aaaaaaaa.status', type: 'string', nullable: true }),
      path({ path: 'device.kind', type: 'enum', options: ['desktop-web'], nullable: true }),
      path({ path: 'signals.count', type: 'integer', nullable: true, tier: 'H', stage: 'beta' }),
    ]);

    expect(schema).toEqual({
      type: 'object',
      properties: {
        inquiry: {
          type: 'object',
          properties: { status: { type: 'string', enum: ['created', 'pending'] } },
        },
        verifications: {
          type: 'object',
          properties: {
            s_aaaaaaaa: {
              type: 'object',
              properties: { status: { type: ['string', 'null'] } },
            },
          },
        },
        device: {
          type: 'object',
          properties: { kind: { type: ['string', 'null'], enum: ['desktop-web', null] } },
        },
        signals: {
          type: 'object',
          properties: { count: { type: ['integer', 'null'], 'x-tier': 'H', 'x-stage': 'beta' } },
        },
      },
    });
  });

  it('marks personal data, and leaves an untyped path open', () => {
    expect(
      scopePathsSchema([
        path({ path: 'inquiry.fields.name', pii: true }),
        path({ path: 'x', type: 'any' }),
      ]),
    ).toEqual({
      type: 'object',
      properties: {
        inquiry: {
          type: 'object',
          properties: {
            fields: {
              type: 'object',
              properties: { name: { type: 'string', 'x-pii': true } },
            },
          },
        },
        x: {},
      },
    });
  });
});

describe('a graph adapter (C155.1)', () => {
  it('answers the same targets for the outline as it accepts on the canvas', () => {
    const targets = LINE_ADAPTER.validTargets(LINE, 'a', 'next');

    expect(targets).toEqual(['b', 'c']);
    for (const target of LINE.nodes) {
      expect(
        LINE_ADAPTER.isValidConnection(LINE, { source: 'a', sourceHandle: 'next', target }),
      ).toBe(targets.includes(target));
    }
  });
});
