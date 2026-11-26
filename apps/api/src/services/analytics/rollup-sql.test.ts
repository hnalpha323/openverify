/**
 * C163.3, C164.1-C164.6 (Workflow 9B, `api-analytics`): the rollup SQL against a seeded synthetic
 * population, each definition recomputed here person by person, independently of the SQL:
 * - an inquiry counts on its creation day in the reporting zone, right across a 23-hour day;
 * - every inquiry column (finished, the three completed splits, expirations, review, decisions,
 *   time to finish), the tag rollup, the funnel from the step record (branch and action steps are
 *   edges), attempts by capture method and country, the per-person step outcome, checks with errored
 *   and not configured their own statuses, reasons, signal bins with `not-evaluated`, cases;
 * - a redacted inquiry is left out of `facts`, and the same SQL restricted to it gives its
 *   contribution; the live columns alone.
 * Every value is synthetic, generated from a fixed seed.
 */
import {
  DURATION_BUCKET_COUNT,
  durationBucketOf,
  signalBinOf,
  type AnalyticsCheckStatus,
} from '@openverify/core';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeCaseRollups, computeCohortRollups, pathSha256 } from './rollup-sql.js';
import {
  seedAnalyticsCase,
  seedAnalyticsCaseTemplate,
  seedAnalyticsDecision,
  seedAnalyticsInquiry,
  seedAnalyticsScreening,
  seedAnalyticsSteps,
  seedAnalyticsTenant,
  seedAnalyticsUser,
  seedAnalyticsVerification,
  type AnalyticsTenant,
} from './testing.js';

const ZONE = 'Europe/Paris';
/** 2026-03-29 is 23 hours long in Paris (summer time starts). */
const DAYS = ['2026-03-28', '2026-03-29', '2026-03-30'] as const;
/** The UTC instants of each local midnight in Paris. */
const MIDNIGHTS: Record<string, number> = {
  '2026-03-28': Date.parse('2026-03-27T23:00:00Z'),
  '2026-03-29': Date.parse('2026-03-28T23:00:00Z'),
  '2026-03-30': Date.parse('2026-03-29T22:00:00Z'),
  '2026-03-31': Date.parse('2026-03-30T22:00:00Z'),
};

/** A small deterministic generator (mulberry32), so the population is the same every run. */
function seeded(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  return { next, pick, chance: (p: number) => next() < p };
}

type Status = 'completed' | 'failed' | 'approved' | 'declined' | 'needs_review';

interface Person {
  id: string;
  day: string;
  redacted: boolean;
  started: boolean;
  finished: { as: 'completed' | 'failed'; afterSeconds: number } | null;
  status: Status | 'pending' | 'expired' | 'created';
  platform: 'web' | 'android' | null;
  device: 'desktop-web' | 'mobile-web' | 'native' | null;
  tags: string[];
  outcome: { verificationTypesOnPath: string[]; fallbacksTaken: string[]; flags: string[] } | null;
  decision: {
    kind: 'approve' | 'decline';
    actor: 'user' | 'api-key' | 'workflow-run';
    auto: boolean | null;
  } | null;
  reviewDecision: boolean;
  steps: { stepId: string; type: string }[];
  attempts: {
    type: 'government_id' | 'selfie';
    status: string;
    country: string | null;
    capture: 'upload' | 'camera' | null;
    checks: {
      name: string;
      status: 'passed' | 'failed' | 'not_applicable' | 'pending';
      reasons: string[];
    }[];
  }[];
  signals: { name: string; value: unknown }[];
  screening: { status: 'pending' | 'completed' | 'errored'; matchCount?: number } | null;
}

const VISIBLE = [
  { stepId: 'start', type: 'consent' },
  { stepId: 'details', type: 'screen' },
  { stepId: 'document', type: 'government_id' },
  { stepId: 'selfie', type: 'selfie' },
  { stepId: 'done', type: 'completion' },
];

function makePerson(random: ReturnType<typeof seeded>, index: number): Omit<Person, 'id'> {
  const day = DAYS[index % DAYS.length] as string;
  const started = random.chance(0.85);
  const finished = started && random.chance(0.7);
  const status: Person['status'] = finished
    ? random.pick<Status>([
        'completed',
        'completed',
        'failed',
        'approved',
        'declined',
        'needs_review',
      ])
    : started
      ? random.pick(['pending', 'expired'] as const)
      : random.pick(['created', 'expired'] as const);
  const steps: Person['steps'] = [];
  if (started) {
    for (const step of VISIBLE) {
      steps.push(step);
      if (step.stepId === 'details' && random.chance(0.3)) {
        steps.push({ stepId: 'route', type: 'branch' });
      }
      if (step.stepId === 'selfie' && random.chance(0.2)) {
        steps.push({ stepId: 'document', type: 'government_id' });
      }
      if (!finished && random.chance(0.3)) {
        break;
      }
    }
  }
  const attempts: Person['attempts'] = steps.some((step) => step.stepId === 'document')
    ? Array.from({ length: 1 + Math.floor(random.next() * 3) }, () => ({
        type: random.pick(['government_id', 'selfie'] as const),
        status: random.pick([
          'initiated',
          'submitted',
          'passed',
          'passed',
          'failed',
          'requires_retry',
          'needs_review',
          'canceled',
          'skipped',
        ]),
        country: random.pick(['FR', 'DE', null]),
        capture: random.pick(['upload', 'camera', null] as const),
        checks: ['id_barcode_detection', 'id_expiration_detection'].map((name) => {
          const kind = random.pick([
            'passed',
            'failed',
            'na',
            'errored',
            'unconfigured',
            'pending',
          ]);
          return kind === 'errored'
            ? {
                name,
                status: 'not_applicable' as const,
                reasons: [random.pick(['execution_error', 'watchlist_unavailable'])],
              }
            : kind === 'unconfigured'
              ? { name, status: 'not_applicable' as const, reasons: ['provider_not_configured'] }
              : kind === 'na'
                ? { name, status: 'not_applicable' as const, reasons: ['id_class_unsupported'] }
                : kind === 'failed'
                  ? {
                      name,
                      status: 'failed' as const,
                      reasons: [random.pick(['barcode_not_found', 'expired'])],
                    }
                  : { name, status: kind as 'passed' | 'pending', reasons: [] };
        }),
      }))
    : [];
  const outcome =
    status === 'completed' && random.chance(0.85)
      ? random.pick([
          { verificationTypesOnPath: ['government-id'], fallbacksTaken: [], flags: [] },
          { verificationTypesOnPath: ['government-id'], fallbacksTaken: ['document'], flags: [] },
          { verificationTypesOnPath: [], fallbacksTaken: [], flags: [] },
          { verificationTypesOnPath: [], fallbacksTaken: [], flags: ['flag_for_review:manual'] },
        ])
      : null;
  return {
    day,
    redacted: random.chance(0.1),
    started,
    finished: finished
      ? {
          as: random.chance(0.8) ? 'completed' : 'failed',
          afterSeconds: Math.floor(Math.exp(random.next() * 12)),
        }
      : null,
    status,
    platform: random.pick(['web', 'android', null] as const),
    device: random.pick(['desktop-web', 'mobile-web', 'native', null] as const),
    tags: random.pick([[], ['vip'], ['vip', 'retry'], ['retry']]),
    outcome,
    decision:
      status === 'approved' || status === 'declined'
        ? {
            kind: status === 'approved' ? 'approve' : 'decline',
            actor: random.pick(['user', 'api-key', 'workflow-run'] as const),
            auto: random.pick([true, false, null]),
          }
        : null,
    reviewDecision: random.chance(0.1),
    steps,
    attempts,
    signals: random.chance(0.2)
      ? []
      : [
          { name: 'inquiry/bot_score', value: random.pick([null, 3, 55, 100]) },
          { name: 'inquiry/tor_detected', value: random.pick([true, false, null]) },
          { name: 'inquiry/country_from_session', value: random.pick(['FR', 'JP', null]) },
          {
            name: 'inquiry/max_session_distance',
            value: random.pick([null, 12_345, 499_999, 2_500_000]),
          },
        ],
    screening: random.pick([
      null,
      { status: 'pending' },
      { status: 'completed', matchCount: random.pick([0, 1, 3, 7]) },
    ]),
  };
}

let database: TestDatabase;
let tenant: AnalyticsTenant;
const people: Person[] = [];

/** The instant of a person's creation: spread across the local day, near both midnights too. */
function createdAtOf(day: string, index: number): Date {
  const start = MIDNIGHTS[day] ?? 0;
  const end = MIDNIGHTS[DAYS[DAYS.indexOf(day as (typeof DAYS)[number]) + 1] ?? '2026-03-31'] ?? 0;
  const offsets = [60_000, end - start - 60_000, (end - start) / 2];
  return new Date(start + (offsets[index % offsets.length] ?? 0));
}

beforeAll(async () => {
  database = await createTestDatabase();
  tenant = await seedAnalyticsTenant(database.db);
  const random = seeded(4_242);
  for (let index = 0; index < 48; index += 1) {
    const person = makePerson(random, index);
    const id = await seedAnalyticsInquiry(database.db, tenant, {
      createdAt: createdAtOf(person.day, Math.floor(index / DAYS.length)),
      status: person.status,
      started: person.started,
      ...(person.finished === null ? {} : { finished: person.finished }),
      platform: person.platform,
      deviceKind: person.device,
      tags: person.tags,
      ...(person.outcome === null ? {} : { flowOutcome: person.outcome }),
      ...(person.signals.length === 0 ? {} : { signals: person.signals }),
    });
    await seedAnalyticsSteps(database.db, tenant, id, person.steps);
    for (const attempt of person.attempts) {
      await seedAnalyticsVerification(database.db, tenant, id, {
        type: attempt.type,
        status: attempt.status,
        country: attempt.country,
        captureMethod: attempt.capture,
        checks: attempt.checks,
      });
    }
    if (person.decision !== null) {
      await seedAnalyticsDecision(database.db, tenant, id, {
        kind: person.decision.kind,
        actorType: person.decision.actor,
        solelyAutomated: person.decision.auto,
      });
    }
    if (person.reviewDecision) {
      await seedAnalyticsDecision(database.db, tenant, id, { kind: 'review' });
    }
    if (person.screening !== null) {
      await seedAnalyticsScreening(database.db, tenant, id, person.screening);
    }
    if (person.redacted) {
      await database.db.execute(sql`update inquiries set redacted_at = now() where id = ${id}`);
    }
    people.push({ ...person, id });
  }
}, 120_000);

afterAll(async () => {
  await database.close();
});

const facts = (from: string, to: string) =>
  computeCohortRollups(
    database.db,
    {
      environmentId: tenant.environmentId,
      timeZone: ZONE,
      source: 'facts',
      selection: { kind: 'facts', from, to },
    },
    'all',
  );

const counted = () => people.filter((person) => !person.redacted);

/** Sorts rows by their JSON, so two lists of rows compare as sets. */
const sorted = (rows: readonly object[]) =>
  [...rows].map((row) => JSON.stringify(row, Object.keys(row).sort())).sort();

const finishedOf = (person: Person) => person.finished !== null;
const decidedOf = (person: Person) =>
  person.decision === null
    ? null
    : person.decision.auto === true
      ? 'automatic'
      : person.decision.auto === false
        ? 'manual'
        : person.decision.actor === 'user'
          ? 'manual'
          : person.decision.actor === 'api-key'
            ? 'not-declared'
            : 'automatic';

describe('the inquiry rollup (C164.1)', () => {
  it('counts each definition per cohort day in the reporting zone, across a 23-hour day', async () => {
    const rows = (await facts(DAYS[0], DAYS[2])).inquiry;
    const expected = new Map<string, Record<string, unknown>>();
    for (const person of counted()) {
      const key = [person.day, person.platform, person.device].join('|');
      const row: Record<string, unknown> = expected.get(key) ?? {
        environmentId: tenant.environmentId,
        day: person.day,
        timeZone: ZONE,
        source: 'facts',
        inquiryTemplateId: tenant.templateId,
        inquiryTemplateVersionId: tenant.versionId,
        platform: person.platform,
        deviceKind: person.device,
        finishSecondsHistogram: Array.from({ length: DURATION_BUCKET_COUNT }, () => 0),
      };
      expected.set(key, row);
      const bump = (column: string, when: boolean) => {
        row[column] = ((row[column] as number | undefined) ?? 0) + (when ? 1 : 0);
      };
      const finished = finishedOf(person);
      const completed = finished && person.status === 'completed';
      const outcome = person.outcome;
      bump('created', true);
      bump('started', person.started);
      bump('interacted', person.started && person.steps.length > 0);
      bump('finished', finished);
      bump('completed', completed);
      bump(
        'completedVerified',
        completed &&
          outcome !== null &&
          outcome.fallbacksTaken.length === 0 &&
          outcome.verificationTypesOnPath.length > 0,
      );
      bump(
        'completedWithFallback',
        completed && outcome !== null && outcome.fallbacksTaken.length > 0,
      );
      bump(
        'completedUnverified',
        completed &&
          outcome !== null &&
          outcome.fallbacksTaken.length === 0 &&
          outcome.verificationTypesOnPath.length === 0,
      );
      bump('failed', finished && person.status === 'failed');
      bump('expiredBeforeStart', person.status === 'expired' && !person.started);
      bump('expiredAfterStart', person.status === 'expired' && person.started && !finished);
      bump('approved', finished && person.status === 'approved');
      bump('declined', finished && person.status === 'declined');
      bump('needsReview', finished && person.status === 'needs_review');
      bump(
        'markedForReview',
        finished &&
          (person.status === 'needs_review' ||
            (outcome?.flags.length ?? 0) > 0 ||
            person.reviewDecision ||
            person.attempts.some((attempt) => attempt.status === 'needs_review')),
      );
      bump('decidedAutomatic', decidedOf(person) === 'automatic');
      bump('decidedManual', decidedOf(person) === 'manual');
      bump('decidedNotDeclared', decidedOf(person) === 'not-declared');
      if (person.finished !== null) {
        const histogram = row.finishSecondsHistogram as number[];
        const at = durationBucketOf(person.finished.afterSeconds);
        histogram[at] = (histogram[at] ?? 0) + 1;
      }
    }
    expect(sorted(rows)).toEqual(sorted([...expected.values()]));
  });

  it('counts an inquiry created at 00:30 local on its own day, not the UTC one', async () => {
    const rows = (await facts('2026-03-30', '2026-03-30')).inquiry;
    const created = rows.reduce((total, row) => total + row.created, 0);
    expect(created).toBe(counted().filter((person) => person.day === '2026-03-30').length);
  });

  it('counts each tag of an inquiry once, by name', async () => {
    const rows = (await facts(DAYS[0], DAYS[2])).tag;
    const expected = new Map<string, number>();
    for (const person of counted()) {
      for (const tag of new Set(person.tags)) {
        const key = `${person.day}|${tag}`;
        expected.set(key, (expected.get(key) ?? 0) + 1);
      }
    }
    const got = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.day}|${row.tag}`;
      got.set(key, (got.get(key) ?? 0) + row.created);
    }
    expect([...got].sort()).toEqual([...expected].sort());
  });

  it('computes the live columns alone, the outcomes left at 0', async () => {
    const rows = (
      await computeCohortRollups(
        database.db,
        {
          environmentId: tenant.environmentId,
          timeZone: ZONE,
          source: 'facts',
          selection: { kind: 'facts', from: DAYS[0], to: DAYS[2] },
        },
        'live',
      )
    ).inquiry;
    expect(rows.reduce((total, row) => total + row.started, 0)).toBe(
      counted().filter((person) => person.started).length,
    );
    expect(rows.every((row) => row.finished === 0 && row.approved === 0)).toBe(true);
  });
});

describe('the funnel from the step record (C164.2)', () => {
  it('counts person-visible steps entered, exited and revisited, transitions and paths', async () => {
    const { step, transition, path } = await facts(DAYS[0], DAYS[2]);
    const visible = (person: Person) =>
      person.steps.filter((entry) => entry.type !== 'branch' && entry.type !== 'action');
    const steps = new Map<string, number[]>();
    const moves = new Map<string, number>();
    const walks = new Map<string, number>();
    for (const person of counted()) {
      const walk = visible(person).map((entry) => entry.stepId);
      for (const stepId of new Set(walk)) {
        const key = `${person.day}|${stepId}`;
        const counts = steps.get(key) ?? [0, 0, 0];
        counts[0] = (counts[0] ?? 0) + 1;
        counts[1] = (counts[1] ?? 0) + 1; // every seeded entry is exited
        counts[2] = (counts[2] ?? 0) + (walk.filter((id) => id === stepId).length > 1 ? 1 : 0);
        steps.set(key, counts);
      }
      // AL6 (K9-24): the first step is entered from the reserved start.
      walk.forEach((to, index) => {
        const key = `${person.day}|${index === 0 ? '$start' : (walk[index - 1] ?? '')}|${to}`;
        moves.set(key, (moves.get(key) ?? 0) + 1);
      });
      if (walk.length > 0) {
        const key = `${person.day}|${pathSha256(walk)}`;
        walks.set(key, (walks.get(key) ?? 0) + 1);
      }
    }
    expect(
      step
        .map((row) => [`${row.day}|${row.stepId}`, [row.entered, row.exited, row.revisits]])
        .sort(),
    ).toEqual([...steps].sort());
    expect(
      transition.map((row) => [`${row.day}|${row.fromStepId}|${row.toStepId}`, row.count]).sort(),
    ).toEqual([...moves].sort());
    expect(path.map((row) => [`${row.day}|${row.pathSha256}`, row.count]).sort()).toEqual(
      [...walks].sort(),
    );
    expect(step.some((row) => row.stepId === 'route')).toBe(false);
  });
});

describe('verifications, steps and checks (C164.3, C164.4)', () => {
  it('counts attempts by type, capture method and country', async () => {
    const { verification } = await facts(DAYS[0], DAYS[2]);
    const expected = new Map<string, number[]>();
    const SUBMITTED = ['submitted', 'passed', 'failed', 'requires_retry', 'needs_review'];
    for (const person of counted()) {
      for (const attempt of person.attempts) {
        const country = attempt.type === 'government_id' ? attempt.country : null;
        const key = [person.day, attempt.type, attempt.capture, country].join('|');
        const counts = expected.get(key) ?? [0, 0, 0, 0, 0, 0, 0, 0];
        const add = (index: number, when: boolean) => {
          counts[index] = (counts[index] ?? 0) + (when ? 1 : 0);
        };
        add(0, true);
        add(1, SUBMITTED.includes(attempt.status));
        add(2, attempt.status === 'passed');
        add(3, attempt.status === 'failed');
        add(4, attempt.status === 'requires_retry');
        add(5, attempt.status === 'skipped');
        add(6, attempt.status === 'needs_review');
        add(7, attempt.status === 'canceled');
        expected.set(key, counts);
      }
    }
    expect(
      verification
        .map((row) => [
          [row.day, row.verificationType, row.captureMethod, row.country].join('|'),
          [
            row.created,
            row.submitted,
            row.passed,
            row.failed,
            row.requiresRetry,
            row.skipped,
            row.needsReview,
            row.canceled,
          ],
        ])
        .sort(),
    ).toEqual([...expected].sort());
  });

  it('gives each verification step its last sent attempt of its type, per person', async () => {
    const { verificationStep } = await facts(DAYS[0], DAYS[2]);
    const expected = new Map<string, number[]>();
    for (const person of counted()) {
      const types = new Map([
        ['document', 'government_id'],
        ['selfie', 'selfie'],
      ]);
      for (const stepId of new Set(person.steps.map((step) => step.stepId))) {
        const type = types.get(stepId);
        if (type === undefined) {
          continue;
        }
        const sent = person.attempts.filter(
          (attempt) =>
            attempt.type === type &&
            attempt.status !== 'initiated' &&
            attempt.status !== 'confirmed',
        );
        const last = sent[sent.length - 1]?.status;
        const key = `${person.day}|${stepId}|${type}`;
        const counts = expected.get(key) ?? [0, 0, 0, 0, 0];
        counts[0] = (counts[0] ?? 0) + 1;
        counts[1] = (counts[1] ?? 0) + (last === 'passed' ? 1 : 0);
        counts[2] = (counts[2] ?? 0) + (last === 'failed' || last === 'requires_retry' ? 1 : 0);
        counts[3] = (counts[3] ?? 0) + (last === 'needs_review' ? 1 : 0);
        counts[4] = (counts[4] ?? 0) + (last === 'skipped' ? 1 : 0);
        expected.set(key, counts);
      }
    }
    expect(
      verificationStep
        .map((row) => [
          `${row.day}|${row.stepId}|${row.verificationType}`,
          [row.entered, row.passed, row.failedAfterAttempts, row.needsReview, row.skipped],
        ])
        .sort(),
    ).toEqual([...expected].sort());
  });

  it('counts errored and not configured results as their own statuses, never not applicable', async () => {
    const { check, checkReason } = await facts(DAYS[0], DAYS[2]);
    const expected = new Map<string, number>();
    const reasons = new Map<string, number>();
    const statusOf = (
      result: Person['attempts'][number]['checks'][number],
    ): AnalyticsCheckStatus =>
      result.status !== 'not_applicable'
        ? result.status
        : result.reasons.includes('provider_not_configured')
          ? 'not_configured'
          : result.reasons.some(
                (reason) => reason === 'execution_error' || reason.endsWith('_unavailable'),
              )
            ? 'errored'
            : 'not_applicable';
    for (const person of counted()) {
      for (const attempt of person.attempts) {
        for (const result of attempt.checks) {
          const key = [person.day, attempt.type, result.name, statusOf(result)].join('|');
          expected.set(key, (expected.get(key) ?? 0) + 1);
          for (const reason of result.reasons) {
            // AL7 (K9-24): a reason keeps its check's type and requirement.
            const reasonKey = [
              person.day,
              attempt.type,
              result.name,
              'required', // every seeded check is required
              reason,
            ].join('|');
            reasons.set(reasonKey, (reasons.get(reasonKey) ?? 0) + 1);
          }
        }
      }
    }
    expect(
      check
        .map((row) => [
          [row.day, row.verificationType, row.checkName, row.status].join('|'),
          row.count,
        ])
        .sort(),
    ).toEqual([...expected].sort());
    expect(
      checkReason
        .map((row) => [
          [row.day, row.verificationType, row.checkName, row.requirement, row.reason].join('|'),
          row.count,
        ])
        .sort(),
    ).toEqual([...reasons].sort());
  });
});

describe('signals (C164.6)', () => {
  it('bins every signal of every inquiry, a missing or null value as not evaluated', async () => {
    const { signal } = await facts(DAYS[0], DAYS[2]);
    const names = [...new Set(signal.map((row) => row.signalName))];
    expect(names).toContain('inquiry/list_match_count');
    for (const name of [
      'inquiry/bot_score',
      'inquiry/max_session_distance',
      'inquiry/country_from_session',
      'inquiry/list_match_count',
      'inquiry/vpn_detected',
    ]) {
      const expected = new Map<string, number>();
      for (const person of counted()) {
        const value =
          name === 'inquiry/list_match_count'
            ? person.screening?.status === 'completed'
              ? (person.screening.matchCount ?? null)
              : null
            : (person.signals.find((entry) => entry.name === name)?.value ?? null);
        const key = `${person.day}|${signalBinOf(name, value)}`;
        expected.set(key, (expected.get(key) ?? 0) + 1);
      }
      const got = new Map<string, number>();
      for (const row of signal.filter((entry) => entry.signalName === name)) {
        const key = `${row.day}|${row.bin}`;
        got.set(key, (got.get(key) ?? 0) + row.count);
      }
      expect([...got].sort(), name).toEqual([...expected].sort());
    }
  });
});

describe('the contribution of one inquiry (C163.4)', () => {
  it('is the same SQL restricted to it, whatever its redaction, labelled with the source given', async () => {
    const person = people.find((entry) => entry.redacted && entry.started) ?? people[0];
    const rows = await computeCohortRollups(
      database.db,
      {
        environmentId: tenant.environmentId,
        timeZone: ZONE,
        source: 'redacted',
        selection: { kind: 'inquiry', inquiryId: person?.id ?? '' },
      },
      'all',
    );
    expect(rows.inquiry).toHaveLength(1);
    expect(rows.inquiry[0]).toMatchObject({ day: person?.day, source: 'redacted', created: 1 });
    // Workflow 10B: 19 registry signals (the five device-integrity ones joined).
    expect(rows.signal.reduce((total, row) => total + row.count, 0)).toBe(19);
  });
});

describe('the case rollups (C164.5; review P20)', () => {
  it('count cases on their own creation day, resolutions, SLAs and the current assignee', async () => {
    const template = await seedAnalyticsCaseTemplate(database.db, tenant);
    const reviewer = await seedAnalyticsUser(database.db, tenant);
    const at = new Date(MIDNIGHTS['2026-03-29'] ?? 0);
    await seedAnalyticsCase(database.db, tenant, template, {
      createdAt: new Date(at.getTime() + 60_000),
      resolvedAfterSeconds: 3_600,
      slaMet: true,
      assigneeId: reviewer,
    });
    await seedAnalyticsCase(database.db, tenant, template, {
      createdAt: new Date(at.getTime() + 120_000),
      slaMissed: true,
      assigneeId: reviewer,
    });
    await seedAnalyticsCase(database.db, tenant, template, {
      createdAt: new Date(at.getTime() - 60_000),
    });
    const rows = await computeCaseRollups(
      database.db,
      { environmentId: tenant.environmentId, timeZone: ZONE, from: '2026-03-28', to: '2026-03-29' },
      'all',
    );
    const byDay = Object.fromEntries(rows.case.map((row) => [row.day, row]));
    expect(byDay['2026-03-29']).toMatchObject({ created: 2, resolved: 1, slaMet: 1, slaMissed: 1 });
    expect(byDay['2026-03-28']).toMatchObject({ created: 1, resolved: 0 });
    expect(byDay['2026-03-29']?.resolutionSecondsHistogram[durationBucketOf(3_600)]).toBe(1);
    expect(rows.assignee).toEqual([
      expect.objectContaining({ day: '2026-03-29', userId: reviewer, assigned: 2, resolved: 1 }),
    ]);
  });
});
