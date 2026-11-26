import { describe, expect, it } from 'vitest';
import {
  CASE_TRANSITION_REFUSALS,
  caseTransitionMapProblems,
  decideCaseTransition,
  initialCaseStatus,
  type CaseStatusMachine,
} from './case-state-machine.js';
import {
  DEFAULT_CASE_RESOLUTIONS,
  DEFAULT_CASE_STATUSES,
  defaultCaseTransitions,
  type CaseStatusDefinition,
} from './vocabulary.js';

const DEFAULTS: CaseStatusMachine = {
  statuses: DEFAULT_CASE_STATUSES,
  resolutions: DEFAULT_CASE_RESOLUTIONS,
  transitions: defaultCaseTransitions(DEFAULT_CASE_STATUSES),
};

const status = (
  key: string,
  category: CaseStatusDefinition['category'],
  rules: Partial<CaseStatusDefinition> = {},
): CaseStatusDefinition => ({
  key,
  label: key.toUpperCase(),
  category,
  'pauses-sla': false,
  'required-comment': false,
  'status-tags': [],
  'status-tag-required': false,
  ...rules,
});

/** A review desk: triage, then waiting on the customer, then escalated or decided. */
const DESK: CaseStatusMachine = {
  statuses: [
    status('triage', 'initial'),
    status('waiting', 'intermediate', { 'pauses-sla': true }),
    status('escalated', 'intermediate', {
      'required-comment': true,
      'status-tags': [
        { key: 'fraud', label: 'Fraud' },
        { key: 'sanctions', label: 'Sanctions' },
      ],
      'status-tag-required': true,
    }),
    status('cleared', 'end', { label: 'Approved' }),
    status('refused', 'end', { 'status-tags': [{ key: 'policy', label: 'Policy' }] }),
  ],
  resolutions: ['Approved', 'Declined', 'Escalated'],
  transitions: {
    triage: ['waiting', 'escalated', 'cleared'],
    waiting: ['triage'],
    escalated: ['cleared', 'refused'],
    cleared: ['triage', 'refused'],
    // `refused` names no exits: it is final.
  },
};

describe('the case status machine on the default statuses (C131.1, a test per edge)', () => {
  const edges = DEFAULT_CASE_STATUSES.flatMap((from) =>
    DEFAULT_CASE_STATUSES.filter((to) => to.key !== from.key).map((to) => [from, to] as const),
  );

  it('has twelve edges: every status to every other', () => {
    expect(edges).toHaveLength(12);
  });

  it.each(edges.map(([from, to]) => [from.key, to.key, from.category, to.category] as const))(
    '%s -> %s',
    (from, to, fromCategory, toCategory) => {
      const decision = decideCaseTransition(DEFAULTS, from, { status: to });
      expect(decision.outcome).toBe('applied');
      if (decision.outcome !== 'applied') {
        return;
      }
      expect(decision.from.key).toBe(from);
      expect(decision.to.key).toBe(to);
      const entersEnd = toCategory === 'end';
      const leavesEnd = fromCategory === 'end';
      expect(decision.resolves).toBe(entersEnd);
      expect(decision.reopens).toBe(leavesEnd && !entersEnd);
      if (entersEnd) {
        // C131.1: with no `meta.resolution`, the status label when it is a resolution.
        expect(decision.resolution).toBe(to === 'approved' ? 'Approved' : 'Declined');
        expect(decision.kind).toBe('resolved');
        expect(decision.events).toEqual(['case.status-updated', 'case.resolved']);
      } else if (leavesEnd) {
        expect(decision.resolution).toBeNull();
        expect(decision.kind).toBe('reopened');
        expect(decision.events).toEqual(['case.status-updated', 'case.reopened']);
      } else {
        expect(decision.resolution).toBeNull();
        expect(decision.kind).toBe('status-changed');
        expect(decision.events).toEqual(['case.status-updated']);
      }
      expect(decision.comment).toBeNull();
      expect(decision.statusTag).toBeNull();
    },
  );

  it('answers no_change for the status a case is already in', () => {
    expect(decideCaseTransition(DEFAULTS, 'open', { status: 'open' })).toEqual({
      outcome: 'no_change',
    });
    expect(
      decideCaseTransition(DEFAULTS, 'approved', { status: 'approved', resolution: 'Declined' }),
    ).toEqual({ outcome: 'no_change' });
  });

  it('starts every case in the one initial status', () => {
    expect(initialCaseStatus(DEFAULTS).key).toBe('open');
    expect(initialCaseStatus(DESK).key).toBe('triage');
  });

  it('refuses a version without exactly one initial status', () => {
    expect(() =>
      initialCaseStatus({ ...DEFAULTS, statuses: DEFAULT_CASE_STATUSES.slice(1) }),
    ).toThrow(/initial/);
  });
});

describe('the transition map (C130.2, C131.1)', () => {
  it('applies only the moves the version allows', () => {
    expect(decideCaseTransition(DESK, 'waiting', { status: 'triage' }).outcome).toBe('applied');
    expect(decideCaseTransition(DESK, 'waiting', { status: 'cleared' })).toEqual({
      outcome: 'refused',
      code: 'case_transition_refused',
      pointer: '/meta/status',
    });
  });

  it('reads a status the map does not name as one with no exits', () => {
    expect(decideCaseTransition(DESK, 'refused', { status: 'triage' })).toMatchObject({
      outcome: 'refused',
      code: 'case_transition_refused',
    });
  });

  it('refuses a status the version does not hold, by key, never by label', () => {
    for (const target of ['missing', 'CLEARED', 'Approved', 'constructor', '__proto__']) {
      expect(decideCaseTransition(DESK, 'triage', { status: target })).toEqual({
        outcome: 'refused',
        code: 'case_transition_refused',
        pointer: '/meta/status',
      });
    }
  });

  it('refuses a move from a status the version does not hold', () => {
    expect(decideCaseTransition(DESK, 'archived', { status: 'triage' })).toMatchObject({
      outcome: 'refused',
      code: 'case_transition_refused',
    });
  });

  it('never reads a map key from the prototype', () => {
    const machine: CaseStatusMachine = { ...DESK, transitions: {} };
    expect(decideCaseTransition(machine, 'triage', { status: 'waiting' }).outcome).toBe('refused');
  });
});

describe('the rules of the status entered (C131.1)', () => {
  it('needs a comment on a status with required-comment, and passes it on', () => {
    expect(
      decideCaseTransition(DESK, 'triage', { status: 'escalated', statusTag: 'fraud' }),
    ).toEqual({ outcome: 'refused', code: 'case_comment_required', pointer: '/meta/comment' });
    expect(
      decideCaseTransition(DESK, 'triage', {
        status: 'escalated',
        statusTag: 'fraud',
        comment: '   \n ',
      }),
    ).toMatchObject({ outcome: 'refused', code: 'case_comment_required' });
    expect(
      decideCaseTransition(DESK, 'triage', {
        status: 'escalated',
        statusTag: 'fraud',
        comment: 'Synthetic note for the test',
      }),
    ).toMatchObject({
      outcome: 'applied',
      comment: 'Synthetic note for the test',
      statusTag: 'fraud',
    });
  });

  it('passes on a comment sent where none is required', () => {
    expect(
      decideCaseTransition(DESK, 'triage', { status: 'waiting', comment: 'Asked for a document' }),
    ).toMatchObject({ outcome: 'applied', comment: 'Asked for a document' });
  });

  it('needs a status tag from the list on a status with status-tag-required', () => {
    expect(decideCaseTransition(DESK, 'triage', { status: 'escalated', comment: 'x' })).toEqual({
      outcome: 'refused',
      code: 'case_status_tag_required',
      pointer: '/meta/status-tag',
    });
    expect(
      decideCaseTransition(DESK, 'triage', {
        status: 'escalated',
        comment: 'x',
        statusTag: 'Fraud',
      }),
    ).toMatchObject({ outcome: 'refused', code: 'case_status_tag_required' });
  });

  it('refuses a status tag the status does not list, even where none is required', () => {
    expect(
      decideCaseTransition(DESK, 'escalated', { status: 'refused', statusTag: 'fraud' }),
    ).toMatchObject({ outcome: 'refused', code: 'case_status_tag_required' });
    expect(
      decideCaseTransition(DESK, 'triage', { status: 'waiting', statusTag: 'policy' }),
    ).toMatchObject({ outcome: 'refused', code: 'case_status_tag_required' });
    expect(
      decideCaseTransition(DESK, 'escalated', { status: 'refused', statusTag: 'policy' }),
    ).toMatchObject({ outcome: 'applied', statusTag: 'policy' });
  });

  it('checks the resolution, then the status tag, then the comment', () => {
    expect(
      decideCaseTransition(DESK, 'escalated', { status: 'cleared', resolution: 'Unknown' }),
    ).toMatchObject({ code: 'case_resolution_invalid' });
    expect(decideCaseTransition(DESK, 'triage', { status: 'escalated' })).toMatchObject({
      code: 'case_status_tag_required',
    });
  });

  it('refuses the map before the rules of the status', () => {
    expect(decideCaseTransition(DESK, 'waiting', { status: 'escalated' })).toMatchObject({
      code: 'case_transition_refused',
    });
  });
});

describe('resolutions (C131.1)', () => {
  it('takes meta.resolution when it is one of the version', () => {
    expect(
      decideCaseTransition(DESK, 'escalated', { status: 'refused', resolution: 'Escalated' }),
    ).toMatchObject({ outcome: 'applied', resolution: 'Escalated', resolves: true });
  });

  it('refuses a resolution the version does not hold, matched exactly', () => {
    for (const resolution of ['Unknown', 'approved', ' Approved']) {
      expect(decideCaseTransition(DESK, 'escalated', { status: 'cleared', resolution })).toEqual({
        outcome: 'refused',
        code: 'case_resolution_invalid',
        pointer: '/meta/resolution',
      });
    }
  });

  it('refuses a resolution sent with a status outside the end category', () => {
    expect(
      decideCaseTransition(DESK, 'triage', { status: 'waiting', resolution: 'Approved' }),
    ).toEqual({ outcome: 'refused', code: 'case_resolution_invalid', pointer: '/meta/resolution' });
  });

  it('takes the status label when it is a resolution, else null', () => {
    expect(decideCaseTransition(DESK, 'triage', { status: 'cleared' })).toMatchObject({
      resolution: 'Approved',
    });
    expect(decideCaseTransition(DESK, 'escalated', { status: 'refused' })).toMatchObject({
      resolution: null,
    });
  });

  it('re-resolves an end-to-end move without reopening', () => {
    expect(decideCaseTransition(DESK, 'cleared', { status: 'refused' })).toMatchObject({
      outcome: 'applied',
      kind: 'resolved',
      resolves: true,
      reopens: false,
      events: ['case.status-updated', 'case.resolved'],
    });
  });

  it('clears the resolution on a reopen', () => {
    expect(decideCaseTransition(DESK, 'cleared', { status: 'triage' })).toMatchObject({
      outcome: 'applied',
      kind: 'reopened',
      resolution: null,
      resolves: false,
      reopens: true,
      events: ['case.status-updated', 'case.reopened'],
    });
  });
});

describe('the refusal codes', () => {
  it('are the four C129.7 names', () => {
    expect(CASE_TRANSITION_REFUSALS).toEqual([
      'case_transition_refused',
      'case_comment_required',
      'case_status_tag_required',
      'case_resolution_invalid',
    ]);
  });
});

describe('the rules publish applies to a version (C130.2)', () => {
  it('passes the defaults and the review desk', () => {
    expect(caseTransitionMapProblems(DEFAULT_CASE_STATUSES, DEFAULTS.transitions)).toEqual([]);
    expect(caseTransitionMapProblems(DESK.statuses, DESK.transitions)).toEqual([]);
  });

  it('refuses an end status unreachable from the initial one, naming it', () => {
    const statuses = [
      status('open', 'initial'),
      status('working', 'intermediate'),
      status('done', 'end'),
      status('lost', 'end'),
      status('island', 'intermediate'),
    ];
    expect(
      caseTransitionMapProblems(statuses, {
        open: ['working'],
        working: ['done'],
        island: ['lost'],
      }),
    ).toEqual([{ code: 'end_status_unreachable', pointer: '/statuses/3' }]);
  });

  it('follows a path through several statuses, and back edges, to reach an end', () => {
    const statuses = [
      status('a', 'initial'),
      status('b', 'intermediate'),
      status('c', 'intermediate'),
      status('z', 'end'),
    ];
    expect(caseTransitionMapProblems(statuses, { a: ['b'], b: ['a', 'c'], c: ['z'] })).toEqual([]);
  });

  it('refuses keys the version does not hold, moves to itself and repeats', () => {
    expect(
      caseTransitionMapProblems(DEFAULT_CASE_STATUSES, {
        open: ['pending', 'pending', 'open', 'approved', 'declined'],
        ghost: ['open'],
        pending: ['nowhere', 'open'],
      }),
    ).toEqual([
      { code: 'transition_repeated', pointer: '/transitions/open/1' },
      { code: 'transition_to_itself', pointer: '/transitions/open/2' },
      { code: 'transition_status_unknown', pointer: '/transitions/ghost' },
      { code: 'transition_status_unknown', pointer: '/transitions/pending/0' },
    ]);
  });

  it('escapes a pointer token as RFC 6901 says', () => {
    expect(
      caseTransitionMapProblems(DEFAULT_CASE_STATUSES, {
        ...DEFAULTS.transitions,
        'a~b/c': ['open'],
      }),
    ).toEqual([{ code: 'transition_status_unknown', pointer: '/transitions/a~0b~1c' }]);
  });

  it('refuses the wrong number of initial statuses, no end and a repeated key', () => {
    expect(
      caseTransitionMapProblems(
        [status('a', 'initial'), status('b', 'initial'), status('b', 'intermediate')],
        { a: ['b'] },
      ),
    ).toEqual([
      { code: 'initial_status_count', pointer: '/statuses' },
      { code: 'end_status_missing', pointer: '/statuses' },
      { code: 'status_repeated', pointer: '/statuses/2' },
    ]);
  });
});
