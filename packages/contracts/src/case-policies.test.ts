import { describe, expect, it } from 'vitest';
import {
  buildCaseAssignmentPolicyResource,
  buildCaseSlaPolicyResource,
  caseAssignmentPolicyDocumentSchema,
  caseAssignmentPolicyListDocumentSchema,
  caseAssignmentPolicyResourceSchema,
  caseSlaPolicyDocumentSchema,
  caseSlaPolicyListDocumentSchema,
  caseSlaPolicyResourceSchema,
  createCaseAssignmentPolicyBodySchema,
  createCaseSlaPolicyBodySchema,
  listCaseAssignmentPoliciesQuerySchema,
  listCaseSlaPoliciesQuerySchema,
  updateCaseAssignmentPolicyBodySchema,
  updateCaseSlaPolicyBodySchema,
} from './case-policies.js';
import { readFixture } from './test-support.js';

const TEMPLATE = 'ctmpl_01M5CN00000000000000000002';
const QUEUE = 'cqueue_01M5CN00000000000000000005';
const POLICY = 'cap_01M5CN00000000000000000006';
const SLA_POLICY = 'cslap_01M5CN00000000000000000007';
const CALENDAR = 'ccal_01M5CN00000000000000000018';
const USER = 'usr_01M5CN00000000000000000010';
const AT = new Date('2026-10-20T12:00:00.000Z');
const LATER = new Date('2026-10-20T12:05:00.000Z');

const assignment = caseAssignmentPolicyDocumentSchema.parse(
  readFixture('api/case-assignment-policy.json'),
);
const sla = caseSlaPolicyDocumentSchema.parse(readFixture('api/case-sla-policy.json'));

describe('assignment policies (C132.2)', () => {
  it('builds the golden policy, its sources in priority order', () => {
    expect(
      buildCaseAssignmentPolicyResource({
        id: POLICY,
        name: 'Round robin by deadline',
        distribution: 'round-robin',
        sort: 'sla-expires-at',
        agentIds: null,
        maxCapacity: null,
        sources: [
          { type: 'case-template', id: TEMPLATE },
          { type: 'case-queue', id: QUEUE },
        ],
        createdAt: AT,
        updatedAt: LATER,
      }),
    ).toEqual(assignment.data);
  });

  it('takes agents as a user list or the routed queue, and a capacity of 1 to 500', () => {
    const attributes = assignment.data.attributes;
    const parse = (patch: Record<string, unknown>) =>
      caseAssignmentPolicyResourceSchema.safeParse({
        ...assignment.data,
        attributes: { ...attributes, ...patch },
      }).success;
    expect(parse({ agents: [USER], 'max-capacity': 500 })).toBe(true);
    expect(parse({ agents: [] })).toBe(false);
    expect(parse({ agents: [USER, USER] })).toBe(false);
    expect(parse({ agents: ['reviewer@example.com'] })).toBe(false);
    expect(parse({ 'max-capacity': 0 })).toBe(false);
    expect(parse({ distribution: 'availability' })).toBe(false);
  });

  it('names a template or a queue as a source, each once, and at least one', () => {
    const attributes = assignment.data.attributes;
    const parse = (sources: unknown) =>
      caseAssignmentPolicyResourceSchema.safeParse({
        ...assignment.data,
        attributes: { ...attributes, sources },
      }).success;
    expect(parse([{ type: 'case-queue', id: QUEUE }])).toBe(true);
    expect(parse([])).toBe(false);
    expect(
      parse([
        { type: 'case-queue', id: QUEUE },
        { type: 'case-queue', id: QUEUE },
      ]),
    ).toBe(false);
    expect(parse([{ type: 'case-queue', id: TEMPLATE }])).toBe(false);
    expect(parse([{ type: 'account', id: 'acc_01M5CJXJF84MR3PHJHBHKQ4ZC8' }])).toBe(false);
  });

  it('creates with a distribution and sources, and updates what it sends', () => {
    expect(
      createCaseAssignmentPolicyBodySchema.safeParse({
        data: {
          type: 'case-assignment-policy',
          attributes: {
            name: 'Fewest open',
            distribution: 'fewest-open',
            sources: [{ type: 'case-template', id: TEMPLATE }],
          },
        },
      }).success,
    ).toBe(true);
    expect(
      createCaseAssignmentPolicyBodySchema.safeParse({
        data: { attributes: { name: 'No sources', distribution: 'fewest-open' } },
      }).success,
    ).toBe(false);
    expect(
      updateCaseAssignmentPolicyBodySchema.safeParse({ data: { attributes: { agents: null } } })
        .success,
    ).toBe(true);
    expect(
      updateCaseAssignmentPolicyBodySchema.safeParse({ data: { attributes: {} } }).success,
    ).toBe(false);
    expect(
      listCaseAssignmentPoliciesQuerySchema.safeParse({ 'filter[distribution]': 'round-robin' })
        .success,
    ).toBe(true);
    expect(
      caseAssignmentPolicyListDocumentSchema.safeParse({ data: [], links: { next: null } }).success,
    ).toBe(true);
  });
});

describe('SLA policies (C133.1)', () => {
  it('builds the golden policy, with its revision', () => {
    expect(
      buildCaseSlaPolicyResource({
        id: SLA_POLICY,
        name: 'Two business days',
        targetMinutes: 840,
        caseCalendarId: CALENDAR,
        onReopen: 'continue',
        revision: 2,
        createdAt: AT,
        updatedAt: LATER,
      }),
    ).toEqual(sla.data);
  });

  it('holds a target to 1 to 525,600 business minutes, around the clock without a calendar', () => {
    const parse = (patch: Record<string, unknown>) =>
      caseSlaPolicyResourceSchema.safeParse({
        ...sla.data,
        attributes: { ...sla.data.attributes, ...patch },
      }).success;
    expect(parse({ 'target-minutes': 1, 'case-calendar-id': null })).toBe(true);
    expect(parse({ 'target-minutes': 525_600 })).toBe(true);
    expect(parse({ 'target-minutes': 0 })).toBe(false);
    expect(parse({ 'target-minutes': 525_601 })).toBe(false);
    expect(parse({ 'target-minutes': 1.5 })).toBe(false);
    expect(parse({ revision: 0 })).toBe(false);
    expect(parse({ 'on-reopen': 'reset' })).toBe(false);
  });

  it('leaves where an SLA starts and what pauses it to the version (C130.2)', () => {
    const attributes = Object.keys(sla.data.attributes);
    expect(attributes).not.toContain('starts-on');
    expect(attributes).not.toContain('pause-categories');
  });

  it('creates with a target, and updates what it sends', () => {
    expect(
      createCaseSlaPolicyBodySchema.safeParse({
        data: { attributes: { name: 'Four hours', 'target-minutes': 240 } },
      }).success,
    ).toBe(true);
    expect(
      createCaseSlaPolicyBodySchema.safeParse({
        data: { attributes: { name: 'Four hours', 'target-minutes': 240, revision: 3 } },
      }).success,
    ).toBe(false);
    expect(
      updateCaseSlaPolicyBodySchema.safeParse({ data: { attributes: { 'on-reopen': 'restart' } } })
        .success,
    ).toBe(true);
    expect(updateCaseSlaPolicyBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(
      false,
    );
    expect(
      listCaseSlaPoliciesQuerySchema.safeParse({ 'filter[case-calendar-id]': CALENDAR }).success,
    ).toBe(true);
    expect(
      caseSlaPolicyListDocumentSchema.safeParse({ data: [], links: { next: null } }).success,
    ).toBe(true);
  });
});
