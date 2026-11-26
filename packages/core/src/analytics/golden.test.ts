/**
 * C164.1-C164.7 (Phase 9, Workflow 9B; `analytics-logic`): the golden vectors. One seeded
 * population's rollup rows and the figures each metric function answers for them, and one seeded
 * table's cells after suppression, committed under `golden/`, so a change to any definition or to the
 * suppression shows as a diff. `api-analytics` may read the same files: the rows are what its rollup
 * must write for the population, and the figures what an answer is built from.
 *
 * To rewrite them after an intended change: `OPENVERIFY_WRITE_ANALYTICS_GOLDEN=1 pnpm exec vitest run
 * src/analytics/golden.test.ts`, then `pnpm exec prettier --write src/analytics/golden/`, and say
 * why in the commit.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_RELATIONS,
  caseAssigneeFigures,
  caseFigures,
  checkFigures,
  funnelFigures,
  inquiryFigures,
  signalFigures,
  verificationFigures,
} from './metrics.js';
import {
  analyticsSeriesCellId,
  analyticsTimeLattice,
  suppressAnalyticsTable,
} from './suppression.js';
import {
  CHECKS,
  caseRows,
  checkRows,
  funnelRows,
  inquiryRows,
  population,
  signalRows,
  verificationRows,
} from './testing/population.js';

const WRITE = process.env.OPENVERIFY_WRITE_ANALYTICS_GOLDEN === '1';

function golden(name: string, value: unknown): void {
  const url = new URL(`./golden/${name}.json`, import.meta.url);
  const json = JSON.parse(JSON.stringify(value)) as unknown;
  if (WRITE) {
    writeFileSync(url, `${JSON.stringify(json, null, 2)}\n`);
  }
  expect(json).toEqual(JSON.parse(readFileSync(url, 'utf8')));
}

const { people, cases } = population(1729, 12);

describe('the golden vectors of the metric functions (C164.1-C164.6)', () => {
  it('inquiries', () => {
    const rows = inquiryRows(people);
    golden('inquiries', { rows, figures: inquiryFigures(rows) });
  });

  it('funnel', () => {
    const rows = funnelRows(people);
    const started = people.filter((p) => p.started).length;
    golden('funnel', { rows, started, figures: funnelFigures(rows, started) });
  });

  it('verifications', () => {
    const rows = verificationRows(people);
    golden('verifications', { rows, figures: verificationFigures(rows.attempts, rows.steps) });
  });

  it('checks', () => {
    const rows = checkRows(people);
    const failedVerifications = 60;
    golden('checks', {
      rows,
      failedVerifications,
      figures: Object.fromEntries(
        CHECKS.map((name) => [
          name,
          checkFigures(
            rows.results.filter((row) => row.checkName === name),
            rows.reasons.filter((row) => row.checkName === name),
            failedVerifications,
          ),
        ]),
      ),
    });
  });

  it('cases', () => {
    const rows = caseRows(cases);
    golden('cases', {
      rows,
      figures: caseFigures(rows.cases, rows.assignees),
      assignees: caseAssigneeFigures(rows.assignees),
    });
  });

  it('signals', () => {
    const names = ['inquiry/bot_score', 'inquiry/country_from_session'];
    golden(
      'signals',
      Object.fromEntries(
        names.map((name) => {
          const rows = signalRows(people, name);
          return [name, { rows, figures: signalFigures(rows) }];
        }),
      ),
    );
  });
});

describe('the golden vector of the suppression (C164.7)', () => {
  it('a week of inquiries, every node and cell as the answers show them', () => {
    const lattice = analyticsTimeLattice('2026-03-02', '2026-03-05');
    const rows = inquiryRows(people);
    const counts = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const figures = inquiryFigures([row]).counts;
      for (const [key, value] of Object.entries(figures)) {
        const days = counts.get(key) ?? new Map<string, number>();
        days.set(row.day, (days.get(row.day) ?? 0) + value);
        counts.set(key, days);
      }
    }
    const table = suppressAnalyticsTable({
      threshold: 11,
      lattice,
      series: counts,
      relations: ANALYTICS_RELATIONS.inquiries,
    });
    const nodes = [...lattice.days, ...lattice.weeks, ...lattice.months, lattice.total];
    golden(
      'suppression-table',
      Object.fromEntries(
        nodes.map((node) => [
          node.id,
          Object.fromEntries(
            [...counts.keys()].map((key) => [key, table.count(analyticsSeriesCellId(key, node))]),
          ),
        ]),
      ),
    );
  });
});
