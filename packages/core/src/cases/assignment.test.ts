import { describe, expect, it } from 'vitest';
import {
  CASE_ASSIGNEE_INELIGIBILITIES,
  assigneeCapacity,
  assigneeIneligibility,
  compareUnassignedCases,
  manualAssigneeIneligibility,
  selectAssignee,
  selectCreator,
  selectFewestOpen,
  selectRoundRobin,
  type CaseAssignmentCandidate,
  type UnassignedCaseOrderKey,
} from './assignment.js';
import { CASE_ASSIGNMENT_DISTRIBUTIONS, CASE_LIMITS } from './vocabulary.js';

const USER_A = 'usr_01JA0000000000000000000001';
const USER_B = 'usr_01JA0000000000000000000002';
const USER_C = 'usr_01JA0000000000000000000003';
const USER_D = 'usr_01JA0000000000000000000004';

const member = (
  userId: string,
  overrides: Partial<CaseAssignmentCandidate> = {},
): CaseAssignmentCandidate => ({
  userId,
  active: true,
  holdsCasesWrite: true,
  seesTemplate: true,
  paused: false,
  openCount: 0,
  maxOpen: 50,
  lastAssignedAt: null,
  ...overrides,
});

const NO_CAP = { maxCapacity: null } as const;
const at = (minute: number) => new Date(Date.UTC(2026, 10, 3, 9, minute));

describe('eligibility (C132.1, C132.3)', () => {
  it('lists its reasons in the order they are checked', () => {
    expect(CASE_ASSIGNEE_INELIGIBILITIES).toEqual([
      'inactive',
      'no_permission',
      'template_hidden',
      'paused',
      'at_capacity',
    ]);
  });

  it('takes an active, permitted, unpaused member under capacity', () => {
    expect(assigneeIneligibility(member(USER_A), NO_CAP)).toBeNull();
  });

  it.each([
    [{ active: false }, 'inactive'],
    [{ holdsCasesWrite: false }, 'no_permission'],
    [{ seesTemplate: false }, 'template_hidden'],
    [{ paused: true }, 'paused'],
    [{ openCount: 50 }, 'at_capacity'],
    [{ active: false, paused: true, openCount: 99 }, 'inactive'],
    [{ seesTemplate: false, paused: true }, 'template_hidden'],
  ] as const)('refuses %o as %s', (overrides, reason) => {
    expect(assigneeIneligibility(member(USER_A, overrides), NO_CAP)).toBe(reason);
  });

  it("caps at the member's max-open, the policy's max-capacity, or the lower of both", () => {
    expect(assigneeCapacity(member(USER_A, { maxOpen: 10 }), NO_CAP)).toBe(10);
    expect(assigneeCapacity(member(USER_A, { maxOpen: 10 }), { maxCapacity: 3 })).toBe(3);
    expect(assigneeCapacity(member(USER_A, { maxOpen: 3 }), { maxCapacity: 10 })).toBe(3);
    expect(assigneeCapacity(member(USER_A, { maxOpen: null }), { maxCapacity: 7 })).toBe(7);
    expect(assigneeCapacity(member(USER_A, { maxOpen: null }), NO_CAP)).toBe(
      CASE_LIMITS['member-max-open-default'].value,
    );
    expect(
      assigneeIneligibility(member(USER_A, { openCount: 3, maxOpen: 10 }), { maxCapacity: 3 }),
    ).toBe('at_capacity');
    expect(
      assigneeIneligibility(member(USER_A, { openCount: 2, maxOpen: 10 }), { maxCapacity: 3 }),
    ).toBeNull();
  });

  it('binds a manual assignment to the organisation, the permission and the template only', () => {
    expect(
      manualAssigneeIneligibility(member(USER_A, { paused: true, openCount: 999 })),
    ).toBeNull();
    expect(manualAssigneeIneligibility(member(USER_A, { active: false }))).toBe('inactive');
    expect(manualAssigneeIneligibility(member(USER_A, { holdsCasesWrite: false }))).toBe(
      'no_permission',
    );
    expect(manualAssigneeIneligibility(member(USER_A, { seesTemplate: false }))).toBe(
      'template_hidden',
    );
  });
});

describe('round-robin (C132.3)', () => {
  // Given out of order: the selection reads user-id order, never the order it was handed.
  const queue = [member(USER_C), member(USER_A), member(USER_B)];

  it('takes the first member when the queue has no cursor yet', () => {
    expect(selectRoundRobin(queue, null, NO_CAP)).toEqual({
      assigned: true,
      strategy: 'round-robin',
      userId: USER_A,
      cursor: USER_A,
      inputs: { cursor: null, eligible: 3, candidates: 3 },
    });
  });

  it('takes the first eligible member after the cursor, and moves the cursor', () => {
    expect(selectRoundRobin(queue, USER_A, NO_CAP)).toMatchObject({
      userId: USER_B,
      cursor: USER_B,
    });
    expect(selectRoundRobin(queue, USER_B, NO_CAP)).toMatchObject({
      userId: USER_C,
      cursor: USER_C,
    });
  });

  it('wraps around after the last member', () => {
    expect(selectRoundRobin(queue, USER_C, NO_CAP)).toMatchObject({ userId: USER_A });
  });

  it('gives every eligible member one turn per cycle', () => {
    let cursor: string | null = null;
    const taken: string[] = [];
    for (let turn = 0; turn < 6; turn += 1) {
      const selection = selectRoundRobin(queue, cursor, NO_CAP);
      if (!selection.assigned) {
        throw new Error('expected an assignment');
      }
      taken.push(selection.userId);
      cursor = selection.cursor;
    }
    expect(taken).toEqual([USER_A, USER_B, USER_C, USER_A, USER_B, USER_C]);
  });

  it('skips paused, full and ineligible members, who keep no turn', () => {
    const mixed = [
      member(USER_A),
      member(USER_B, { paused: true }),
      member(USER_C, { openCount: 50 }),
      member(USER_D),
    ];
    expect(selectRoundRobin(mixed, USER_A, NO_CAP)).toMatchObject({
      userId: USER_D,
      inputs: { cursor: USER_A, eligible: 2, candidates: 4 },
    });
    expect(selectRoundRobin(mixed, USER_D, NO_CAP)).toMatchObject({ userId: USER_A });
  });

  it('reads a cursor of a member who left as a place in user-id order', () => {
    expect(selectRoundRobin([member(USER_A), member(USER_C)], USER_B, NO_CAP)).toMatchObject({
      userId: USER_C,
    });
  });

  it('takes the cursor member again when no one else is eligible', () => {
    expect(
      selectRoundRobin([member(USER_A), member(USER_B, { active: false })], USER_A, NO_CAP),
    ).toMatchObject({ userId: USER_A, cursor: USER_A });
  });

  it('leaves the case unassigned, and the cursor where it was, when nobody is eligible', () => {
    expect(
      selectRoundRobin([member(USER_A, { paused: true })], USER_A, { maxCapacity: null }),
    ).toEqual({
      assigned: false,
      strategy: 'round-robin',
      reason: 'no_eligible_agent',
      cursor: USER_A,
      inputs: { cursor: USER_A, eligible: 0, candidates: 1 },
    });
    expect(selectRoundRobin([], null, NO_CAP)).toMatchObject({
      assigned: false,
      reason: 'no_eligible_agent',
      cursor: null,
    });
  });
});

describe('fewest-open (C132.3, decision 67)', () => {
  it('takes the eligible member with the fewest open cases', () => {
    expect(
      selectFewestOpen(
        [
          member(USER_A, { openCount: 4 }),
          member(USER_B, { openCount: 1 }),
          member(USER_C, { openCount: 0, paused: true }),
        ],
        NO_CAP,
      ),
    ).toEqual({
      assigned: true,
      strategy: 'fewest-open',
      userId: USER_B,
      cursor: null,
      inputs: { 'open-count': 1, eligible: 2, candidates: 3, tied: 1 },
    });
  });

  it('breaks a tie on the least recently assigned, never-assigned first', () => {
    expect(
      selectFewestOpen(
        [
          member(USER_A, { openCount: 2, lastAssignedAt: at(30) }),
          member(USER_B, { openCount: 2, lastAssignedAt: at(10) }),
          member(USER_C, { openCount: 5, lastAssignedAt: null }),
        ],
        NO_CAP,
      ),
    ).toMatchObject({ userId: USER_B, inputs: { tied: 2 } });
    expect(
      selectFewestOpen(
        [
          member(USER_A, { openCount: 2, lastAssignedAt: at(10) }),
          member(USER_B, { openCount: 2, lastAssignedAt: null }),
        ],
        NO_CAP,
      ),
    ).toMatchObject({ userId: USER_B });
  });

  it('breaks a full tie on the user id, whatever order it was handed', () => {
    const tied = [
      member(USER_C, { openCount: 1, lastAssignedAt: at(5) }),
      member(USER_B, { openCount: 1, lastAssignedAt: at(5) }),
      member(USER_D, { openCount: 1, lastAssignedAt: at(5) }),
    ];
    expect(selectFewestOpen(tied, NO_CAP)).toMatchObject({ userId: USER_B, inputs: { tied: 3 } });
    expect(selectFewestOpen([...tied].reverse(), NO_CAP)).toMatchObject({ userId: USER_B });
    expect(
      selectFewestOpen(
        [member(USER_B, { lastAssignedAt: null }), member(USER_A, { lastAssignedAt: null })],
        NO_CAP,
      ),
    ).toMatchObject({ userId: USER_A });
  });

  it('passes over a member at their own max-open, however few they hold', () => {
    expect(
      selectFewestOpen(
        [member(USER_A, { openCount: 2, maxOpen: 2 }), member(USER_B, { openCount: 3 })],
        NO_CAP,
      ),
    ).toMatchObject({ assigned: true, userId: USER_B, inputs: { 'open-count': 3, eligible: 1 } });
  });

  it('leaves the case unassigned when nobody is eligible', () => {
    expect(selectFewestOpen([member(USER_A, { openCount: 2 })], { maxCapacity: 2 })).toEqual({
      assigned: false,
      strategy: 'fewest-open',
      reason: 'no_eligible_agent',
      cursor: null,
      inputs: { 'open-count': null, eligible: 0, candidates: 1, tied: 0 },
    });
  });
});

describe('case-creator and inquiry-creator (C132.3)', () => {
  const agents = [member(USER_A), member(USER_B, { paused: true })];

  it('assigns the creator when they are an eligible agent', () => {
    expect(selectCreator('case-creator', USER_A, agents, NO_CAP)).toEqual({
      assigned: true,
      strategy: 'case-creator',
      userId: USER_A,
      cursor: null,
      inputs: { creator: USER_A },
    });
    expect(selectCreator('inquiry-creator', USER_A, agents, NO_CAP)).toMatchObject({
      strategy: 'inquiry-creator',
      userId: USER_A,
    });
  });

  it('leaves the case unassigned when the creator is not a user', () => {
    expect(selectCreator('inquiry-creator', null, agents, NO_CAP)).toEqual({
      assigned: false,
      strategy: 'inquiry-creator',
      reason: 'creator_unknown',
      cursor: null,
      inputs: { creator: null },
    });
  });

  it('leaves the case unassigned when the creator is no agent or not eligible', () => {
    expect(selectCreator('case-creator', USER_B, agents, NO_CAP)).toMatchObject({
      assigned: false,
      reason: 'creator_ineligible',
      inputs: { creator: USER_B },
    });
    expect(selectCreator('case-creator', USER_C, agents, NO_CAP)).toMatchObject({
      assigned: false,
      reason: 'creator_ineligible',
    });
  });
});

describe('a distribution applied (C132.2)', () => {
  const request = {
    candidates: [member(USER_A, { openCount: 3 }), member(USER_B, { openCount: 1 })],
    limits: NO_CAP,
    cursor: USER_A,
    creatorUserId: USER_A,
  };

  it('dispatches each of the four distributions', () => {
    const chosen = Object.fromEntries(
      CASE_ASSIGNMENT_DISTRIBUTIONS.map((distribution) => {
        const selection = selectAssignee(distribution, request);
        return [distribution, selection.assigned ? selection.userId : null];
      }),
    );
    expect(chosen).toEqual({
      'round-robin': USER_B,
      'fewest-open': USER_B,
      'case-creator': USER_A,
      'inquiry-creator': USER_A,
    });
  });
});

describe('the order unassigned cases are taken in (C132.2, C132.3)', () => {
  const key = (
    id: string,
    createdMinute: number,
    slaMinute: number | null,
  ): UnassignedCaseOrderKey => ({
    id,
    createdAt: at(createdMinute),
    slaExpiresAt: slaMinute === null ? null : at(slaMinute),
  });
  const cases = [
    key('case_01JA0000000000000000000005', 1, null),
    key('case_01JA0000000000000000000004', 2, 40),
    key('case_01JA0000000000000000000003', 3, 20),
    key('case_01JA0000000000000000000002', 1, 20),
    key('case_01JA0000000000000000000001', 1, null),
  ];
  const ids = (sorted: readonly UnassignedCaseOrderKey[]) => sorted.map(({ id }) => id.slice(-1));

  it('by sla-expires-at: the earliest deadline, no deadline last, then age, then id', () => {
    expect(ids([...cases].sort(compareUnassignedCases('sla-expires-at')))).toEqual([
      '2',
      '3',
      '4',
      '1',
      '5',
    ]);
  });

  it('by created-at: the oldest, then id', () => {
    expect(ids([...cases].sort(compareUnassignedCases('created-at')))).toEqual([
      '1',
      '2',
      '5',
      '4',
      '3',
    ]);
  });
});
