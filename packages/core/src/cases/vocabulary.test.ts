import { describe, expect, it } from 'vitest';
import {
  CASE_ACTION_PLACEMENTS,
  CASE_ACTION_STATUSES,
  CASE_ASSIGNER_TYPES,
  CASE_ATTACHMENT_TYPES,
  CASE_BULK_ACTIONS,
  CASE_BULK_OUTCOMES,
  CASE_BULK_STATUSES,
  CASE_COMMENTER_TYPES,
  CASE_CREATOR_TYPES,
  CASE_HELD_OBJECT_ID_PREFIXES,
  CASE_HELD_OBJECT_TYPES,
  CASE_HISTORY_KINDS,
  CASE_LAYOUT_MODULES,
  CASE_LIMITS,
  CASE_NOTIFICATION_KINDS,
  CASE_RESOLVER_TYPES,
  CASE_SEARCH_ATTRIBUTES,
  CASE_SEARCH_OPERATORS,
  CASE_SLA_STARTS_ON,
  CASE_STATUS_CATEGORIES,
  CASE_STATUS_KEY_PATTERN,
  CASE_TEMPLATE_KEY_PATTERN,
  CASE_TEMPLATE_STATUSES,
  CASE_TEMPLATE_VERSION_STATUSES,
  CASE_UPDATER_TYPES,
  DEFAULT_CASE_RESOLUTIONS,
  DEFAULT_CASE_STATUSES,
  defaultCaseTransitions,
} from '../index.js';

describe('the case vocabularies (C129-C138)', () => {
  it('holds the public categories, and draft, published and superseded versions', () => {
    expect(CASE_STATUS_CATEGORIES).toEqual(['initial', 'intermediate', 'end']);
    expect(CASE_TEMPLATE_STATUSES).toEqual(['active', 'archived']);
    expect(CASE_TEMPLATE_VERSION_STATUSES).toEqual(['draft', 'published', 'superseded']);
  });

  it('names each actor the public types name, with an API key wherever a key can act (C129.2)', () => {
    expect(CASE_CREATOR_TYPES).toEqual(['user', 'api-key', 'workflow-run']);
    expect(CASE_ASSIGNER_TYPES).toEqual([
      'case-assignment-policy',
      'user',
      'api-key',
      'workflow-run',
    ]);
    expect(CASE_RESOLVER_TYPES).toEqual(['api-key', 'user', 'workflow-run']);
    expect(CASE_UPDATER_TYPES).toEqual([
      'api-key',
      'case-assignment-policy',
      'user',
      'workflow-run',
    ]);
    expect(CASE_COMMENTER_TYPES).toEqual(['user', 'api-key', 'workflow-run']);
  });

  it('holds what a case holds, a document being a document verification (C136.1)', () => {
    expect(CASE_HELD_OBJECT_TYPES).toEqual([
      'account',
      'inquiry',
      'report',
      'report-run',
      'transaction',
      'verification',
      'graph-query',
      'document',
    ]);
    expect(CASE_HELD_OBJECT_ID_PREFIXES).toEqual({
      account: 'acc',
      inquiry: 'inq',
      report: 'rep',
      'report-run': 'rpr',
      transaction: 'txn',
      verification: 'ver',
      'graph-query': 'grphq',
      document: 'ver',
    });
  });

  it('holds the attachment types, the SLA starts and the default modules (C130.2, C142.2)', () => {
    expect(CASE_ATTACHMENT_TYPES).toEqual(['jpeg', 'png', 'webp', 'pdf']);
    expect(CASE_SLA_STARTS_ON).toEqual(['created', 'entered-queue', 'assigned']);
    expect(CASE_LAYOUT_MODULES).toEqual([
      'held-objects',
      'reports',
      'report-runs',
      'transactions',
      'list-matches',
      'graph',
      'signals',
      'device',
      'location',
      'timeline',
      'comments',
      'attachments',
      'case-actions',
    ]);
  });

  it('closes the history kinds, so a kind can never be a value (C131.4)', () => {
    expect(new Set(CASE_HISTORY_KINDS).size).toBe(CASE_HISTORY_KINDS.length);
    for (const kind of CASE_HISTORY_KINDS) {
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      expect(kind).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    }
    expect(CASE_HISTORY_KINDS).toEqual(
      expect.arrayContaining([
        'created',
        'status-changed',
        'resolved',
        'reopened',
        'assigned',
        'fields-changed',
        'comment-added',
        'object-attached',
        'attachment-added',
        'redacted',
      ]),
    );
  });

  it('holds the notifications, case actions and bulk actions (C134.4, C140.1, C137.4)', () => {
    expect(CASE_NOTIFICATION_KINDS).toEqual(['assigned', 'sla-breached', 'mentioned']);
    expect(CASE_ACTION_STATUSES).toEqual(['active', 'archived']);
    expect(CASE_ACTION_PLACEMENTS).toEqual(['header']);
    expect(CASE_BULK_ACTIONS).toEqual([
      'assign',
      'set-status',
      'set-queue',
      'add-tags',
      'remove-tags',
    ]);
    expect(CASE_BULK_STATUSES).toEqual(['pending', 'running', 'completed']);
    expect(CASE_BULK_OUTCOMES).toEqual(['applied', 'no_change', 'refused']);
  });

  it('holds the public search attributes and operators (C137.2)', () => {
    expect(CASE_SEARCH_OPERATORS).toEqual(['eq', 'gt', 'gte', 'lt', 'lte']);
    expect(CASE_SEARCH_ATTRIBUTES).toEqual([
      'template',
      'case_template_id',
      'status',
      'state',
      'resolution',
      'created_at',
      'updated_at',
      'resolved_at',
      'sla_expires_at',
      'assignee',
      'case_queue',
      'case_queue_id',
      'resolver',
      'account_id',
      'inquiry_id',
      'tag_id',
    ]);
  });

  it('states every limit with its basis and source', () => {
    expect(CASE_LIMITS['held-objects'].value).toBe(1000);
    expect(CASE_LIMITS['held-objects'].basis).toBe('public');
    expect(CASE_LIMITS['bulk-cases'].value).toBe(500);
    expect(CASE_LIMITS['export-cases'].value).toBe(10_000);
    expect(CASE_LIMITS['comment-characters'].value).toBe(10_000);
    expect(CASE_LIMITS['sla-seconds'].value).toBe(7_776_000);
    expect(CASE_LIMITS['search-depth'].value).toBe(2);
    expect(CASE_LIMITS['search-clauses'].value).toBe(20);
    for (const limit of Object.values(CASE_LIMITS)) {
      expect(limit.value).toBeGreaterThan(0);
      expect(['public', 'provisional']).toContain(limit.basis);
      expect(limit.source).not.toBe('');
    }
  });

  it('reads a template key and a status key by their patterns (C130.1, C130.2)', () => {
    expect(CASE_TEMPLATE_KEY_PATTERN.test('KYC')).toBe(true);
    expect(CASE_TEMPLATE_KEY_PATTERN.test('K')).toBe(false);
    expect(CASE_TEMPLATE_KEY_PATTERN.test('kyc')).toBe(false);
    expect(CASE_TEMPLATE_KEY_PATTERN.test('KYC2024LONG')).toBe(false);
    expect(CASE_STATUS_KEY_PATTERN.test('in_review')).toBe(true);
    expect(CASE_STATUS_KEY_PATTERN.test('In review')).toBe(false);
  });

  it('defaults to the public statuses and resolutions (C130.2)', () => {
    expect(
      DEFAULT_CASE_STATUSES.map(({ key, label, category, 'pauses-sla': pauses }) => [
        key,
        label,
        category,
        pauses,
      ]),
    ).toEqual([
      ['open', 'Open', 'initial', false],
      ['pending', 'Pending', 'intermediate', true],
      ['approved', 'Approved', 'end', false],
      ['declined', 'Declined', 'end', false],
    ]);
    expect(DEFAULT_CASE_RESOLUTIONS).toEqual(['Approved', 'Declined']);
  });

  it('defaults every status to every other (C130.2)', () => {
    expect(defaultCaseTransitions([{ key: 'open' }, { key: 'pending' }, { key: 'done' }])).toEqual({
      open: ['pending', 'done'],
      pending: ['open', 'done'],
      done: ['open', 'pending'],
    });
  });
});
