// @vitest-environment node
/**
 * C171.6 (decision 71; review H12; Workflow 9D, a11y-audit): the accessibility statement
 * (`docs/accessibility/statement.md`) claims no conformance beyond what the newest audit's manual
 * results cover. With no manual result it says "not yet evaluated for conformance" and never says
 * "conforms"; once a person has filled rows, a sentence claiming conformance cites the rows (`M1`
 * to `M14`) it rests on, each with a pass. It names the standard, the date and the audit.
 *
 * C212.5 (Phase 10, Workflow 10D, android-a11y-audit): the statement's Android part (its
 * "## Android SDK" section) is held the same way to the newest `android-audit-<date>.md`: it names
 * that audit, says "not yet evaluated for conformance" while that audit's manual results table is
 * empty, and a claim in it cites the rows (`A1`, `A2`, ...) it rests on, each with a pass.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOCS = new URL('../../../docs/accessibility/', import.meta.url);
const NOT_EVALUATED = 'not yet evaluated for conformance';
const RESULTS_HEADING = '### Manual results';
/** A claim: "conforms", "conformant", "conforming" (never "conformance", which the denial uses). */
const CLAIM = /\bconform(?:s|ant|ing)\b/iu;

/** The newest audit file's name: `audit-YYYY-MM-DD.md`, or with `prefix` the Android one's. */
function newestAudit(prefix = ''): string {
  const audits = readdirSync(DOCS)
    .filter(
      (name) =>
        name.startsWith(`${prefix}audit-`) &&
        /^audit-\d{4}-\d{2}-\d{2}\.md$/u.test(name.slice(prefix.length)),
    )
    .sort();
  const newest = audits.at(-1);
  if (newest === undefined) {
    throw new Error(`docs/accessibility holds no ${prefix}audit-<date>.md`);
  }
  return newest;
}

const ANDROID_HEADING = '## Android SDK';

/** The statement's Android part (from its heading to the next second-level one) and the rest. */
function partsOf(statement: string): { android: string; web: string } {
  const start = statement.indexOf(`${ANDROID_HEADING}\n`);
  if (start < 0) {
    return { android: '', web: statement };
  }
  const next = statement.indexOf('\n## ', start + ANDROID_HEADING.length);
  const end = next < 0 ? statement.length : next;
  return {
    android: statement.slice(start, end),
    web: statement.slice(0, start) + statement.slice(end),
  };
}

/** Where a part of the statement claims more than `results` cover; its rows are cited as `row`. */
function claimProblems(part: string, results: readonly string[][], row: RegExp): string[] {
  const problems: string[] = [];
  const claims = sentencesOf(part).filter((sentence) => CLAIM.test(sentence));
  if (results.length === 0) {
    problems.push(...claims.map((claim) => `claims conformance with no manual result: ${claim}`));
    if (!part.includes(NOT_EVALUATED)) {
      problems.push(`does not say "${NOT_EVALUATED}"`);
    }
  } else {
    const passed = new Set(
      results.filter((cells) => /^pass$/iu.test(cells[4] ?? '')).map((cells) => cells[0] ?? ''),
    );
    for (const claim of claims) {
      const cited = [...claim.matchAll(row)].map((match) => match[0]);
      if (cited.length === 0 || cited.some((id) => !passed.has(id))) {
        problems.push(`claims conformance beyond the passed manual rows: ${claim}`);
      }
    }
  }
  return problems;
}

/** The data rows of the audit's manual results table, as cells; none while it is empty. */
function manualResults(audit: string): string[][] {
  const start = audit.indexOf(RESULTS_HEADING);
  if (start < 0) {
    throw new Error(`the audit has no "${RESULTS_HEADING}" section`);
  }
  const lines = audit
    .slice(start + RESULTS_HEADING.length)
    .split('\n')
    .map((line) => line.trim());
  const first = lines.findIndex((line) => line.startsWith('|'));
  const table = lines.slice(first);
  const end = table.findIndex((line) => !line.startsWith('|'));
  const rows = end < 0 ? table : table.slice(0, end);
  return rows.slice(2).map((row) =>
    row
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim()),
  );
}

/** The statement's sentences, roughly: split after a full stop, a colon's list or a line break. */
const sentencesOf = (text: string) =>
  text
    .split(/(?<=\.)\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');

/**
 * Where `statement` claims more than the manual rows cover: `results` are the web audit's, for
 * everything outside the Android part, and `android` the Android audit's, for that part.
 */
function statementProblems(
  statement: string,
  results: readonly string[][],
  android: readonly string[][] = [],
): string[] {
  const parts = partsOf(statement);
  const problems = claimProblems(parts.web, results, /\bM\d{1,2}\b/gu);
  if (parts.android === '') {
    problems.push(`has no "${ANDROID_HEADING}" section`);
  } else {
    problems.push(
      ...claimProblems(parts.android, android, /\bA\d{1,2}\b/gu).map(
        (problem) => `Android: ${problem}`,
      ),
    );
  }
  if (!statement.includes('WCAG 2.2') || !/\bAA\b/u.test(statement)) {
    problems.push('names no standard (WCAG 2.2 AA)');
  }
  if (!/\b\d{4}-\d{2}-\d{2}\b/u.test(statement)) {
    problems.push('states no date');
  }
  return problems;
}

const BASE = `WCAG 2.2 level AA. 2026-11-07.`;
const ANDROID = `\n${ANDROID_HEADING}\nIt is ${NOT_EVALUATED}.\n`;

describe('the rule the statement is held to', () => {
  it('with no manual result: refuses "conforms" and needs the denial', () => {
    expect(statementProblems(`${BASE} The flow conforms to WCAG 2.2 AA.${ANDROID}`, [])).toEqual([
      'claims conformance with no manual result: The flow conforms to WCAG 2.2 AA.',
      `does not say "${NOT_EVALUATED}"`,
    ]);
    expect(statementProblems(`${BASE} It is ${NOT_EVALUATED}.${ANDROID}`, [])).toEqual([]);
  });

  it('with manual results: a claim cites the rows it rests on, each a pass', () => {
    const results = [
      ['M1', 'An auditor', '2026-12-01', 'Chrome 140', 'pass', ''],
      ['M3', 'An auditor', '2026-12-01', 'NVDA 2026.1, Firefox 150', 'fail', 'K-1'],
    ];
    const claims = (text: string) => statementProblems(`${BASE} ${text}${ANDROID}`, results);
    expect(claims('By keyboard (M1) the flow conforms.')).toEqual([]);
    expect(claims('With NVDA (M3) the flow conforms.')).toHaveLength(1);
    expect(claims('The console conforms.')).toHaveLength(1);
  });

  it('needs the standard, the Android part and a date', () => {
    expect(statementProblems(`It is ${NOT_EVALUATED}.`, [])).toEqual([
      `has no "${ANDROID_HEADING}" section`,
      'names no standard (WCAG 2.2 AA)',
      'states no date',
    ]);
  });

  it('holds the Android part to the Android audit alone', () => {
    const web = `${BASE} It is ${NOT_EVALUATED}.`;
    const passed = [['M1', 'An auditor', '2026-12-01', 'Chrome 140', 'pass', '']];
    const android = [
      ['A1', 'An auditor', '2026-12-02', 'A Pixel 9, Android 17, TalkBack 16', 'pass', ''],
      ['A2', 'An auditor', '2026-12-02', 'A Pixel 9, Android 17', 'fail', 'K-2'],
    ];
    const claim = `\n${ANDROID_HEADING}\nWith TalkBack (A1) the SDK conforms.\n`;

    // A web pass says nothing about Android, and the web's denial does not stand for Android's.
    expect(statementProblems(`${web}${claim}`, passed)).toEqual([
      'Android: claims conformance with no manual result: With TalkBack (A1) the SDK conforms.',
      `Android: does not say "${NOT_EVALUATED}"`,
    ]);
    expect(statementProblems(`${web}\n${ANDROID_HEADING}\nNothing is said.\n`, [])).toEqual([
      `Android: does not say "${NOT_EVALUATED}"`,
    ]);
    expect(statementProblems(`${web}${claim}`, [], android)).toEqual([]);
    expect(
      statementProblems(
        `${web}\n${ANDROID_HEADING}\nAt 200% (A2) the SDK conforms.\n`,
        [],
        android,
      ),
    ).toHaveLength(1);
    // The part ends at the next section: a claim after it is the web's.
    expect(
      statementProblems(`${web}${claim}\n## Known gaps\nThe flow conforms.\n`, [], android),
    ).toEqual(['claims conformance with no manual result: The flow conforms.']);
  });
});

describe('docs/accessibility/statement.md', () => {
  it('names the newest audits, and claims nothing beyond their manual results', () => {
    const audit = newestAudit();
    const androidAudit = newestAudit('android-');
    const statement = readFileSync(new URL('statement.md', DOCS), 'utf8');
    const results = manualResults(readFileSync(new URL(audit, DOCS), 'utf8'));
    const android = manualResults(readFileSync(new URL(androidAudit, DOCS), 'utf8'));

    expect(statement).toContain(audit);
    expect(partsOf(statement).android).toContain(androidAudit);
    expect(statementProblems(statement, results, android)).toEqual([]);
  });
});
