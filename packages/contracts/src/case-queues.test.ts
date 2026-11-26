import { describe, expect, it } from 'vitest';
import {
  buildCaseQueueResource,
  caseQueueAttributesSchema,
  caseQueueDocumentSchema,
  caseQueueListDocumentSchema,
  createCaseQueueBodySchema,
  listCaseQueuesQuerySchema,
  setCaseQueueMembersBodySchema,
  updateCaseQueueBodySchema,
} from './case-queues.js';
import { readFixture } from './test-support.js';

const QUEUE = 'cqueue_01M5CN00000000000000000005';
const POLICY = 'cap_01M5CN00000000000000000006';
const USER = 'usr_01M5CN00000000000000000010';
const REVIEWER = 'usr_01M5CN00000000000000000011';
const AT = new Date('2026-10-20T12:00:00.000Z');
const LATER = new Date('2026-10-20T12:05:00.000Z');

const golden = caseQueueDocumentSchema.parse(readFixture('api/case-queue.json'));

describe('case queues (C132.1)', () => {
  it('builds the golden queue, with its members and its policy', () => {
    expect(
      buildCaseQueueResource({
        id: QUEUE,
        name: 'Know your customer reviews',
        status: 'active',
        members: [
          { userId: REVIEWER, maxOpen: 50, paused: false },
          { userId: USER, maxOpen: 20, paused: true },
        ],
        caseAssignmentPolicyId: POLICY,
        createdAt: AT,
        updatedAt: LATER,
        archivedAt: null,
      }),
    ).toEqual(golden.data);
  });

  it('has archived-at exactly when it is archived', () => {
    const attributes = golden.data.attributes;
    expect(
      caseQueueAttributesSchema.safeParse({
        ...attributes,
        status: 'archived',
        'archived-at': '2026-10-21T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(caseQueueAttributesSchema.safeParse({ ...attributes, status: 'archived' }).success).toBe(
      false,
    );
    expect(
      caseQueueAttributesSchema.safeParse({
        ...attributes,
        'archived-at': '2026-10-21T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('holds a member to 1 to 500 open cases and names each user once', () => {
    const attributes = golden.data.attributes;
    const member = { 'user-id': REVIEWER, paused: false };
    for (const [maxOpen, fits] of [
      [1, true],
      [500, true],
      [0, false],
      [501, false],
    ] as const) {
      expect(
        caseQueueAttributesSchema.safeParse({
          ...attributes,
          members: [{ ...member, 'max-open': maxOpen }],
        }).success,
        String(maxOpen),
      ).toBe(fits);
    }
    expect(
      caseQueueAttributesSchema.safeParse({
        ...attributes,
        members: [
          { ...member, 'max-open': 5 },
          { ...member, 'max-open': 6 },
        ],
      }).success,
    ).toBe(false);
    expect(
      caseQueueAttributesSchema.safeParse({
        ...attributes,
        members: [{ ...member, 'user-id': 'reviewer@example.com', 'max-open': 5 }],
      }).success,
    ).toBe(false);
  });

  it('creates with defaults left to the service, and archives for good (C132.1)', () => {
    expect(
      createCaseQueueBodySchema.safeParse({
        data: { type: 'case-queue', attributes: { name: 'Second line' } },
      }).success,
    ).toBe(true);
    expect(
      createCaseQueueBodySchema.safeParse({
        data: { attributes: { name: 'Second line', members: [{ 'user-id': USER }] } },
      }).success,
    ).toBe(true);
    expect(
      updateCaseQueueBodySchema.safeParse({ data: { attributes: { status: 'archived' } } }).success,
    ).toBe(true);
    expect(
      updateCaseQueueBodySchema.safeParse({ data: { attributes: { status: 'active' } } }).success,
    ).toBe(false);
    expect(
      updateCaseQueueBodySchema.safeParse({
        data: { attributes: { 'case-assignment-policy-id': null } },
      }).success,
    ).toBe(true);
    expect(updateCaseQueueBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(false);
  });

  it('replaces the members whole, and an empty list empties the queue', () => {
    expect(
      setCaseQueueMembersBodySchema.safeParse({
        data: { attributes: { members: [{ 'user-id': USER, 'max-open': 10, paused: true }] } },
      }).success,
    ).toBe(true);
    expect(
      setCaseQueueMembersBodySchema.safeParse({ data: { attributes: { members: [] } } }).success,
    ).toBe(true);
    expect(setCaseQueueMembersBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(
      false,
    );
  });

  it('lists by status and by member, newest first', () => {
    expect(
      listCaseQueuesQuerySchema.safeParse({
        'filter[status]': 'active',
        'filter[member-id]': USER,
        'page[after]': QUEUE,
      }).success,
    ).toBe(true);
    expect(listCaseQueuesQuerySchema.safeParse({ 'filter[member-id]': POLICY }).success).toBe(
      false,
    );
    expect(caseQueueListDocumentSchema.safeParse({ data: [], links: { next: null } }).success).toBe(
      true,
    );
  });
});
