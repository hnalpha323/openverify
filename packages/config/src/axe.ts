/**
 * C171.2 (Workflow 9A Stage 1b (A11Y)): the pure half of the accessibility helpers both Playwright
 * suites share: `expectAccessible` in `apps/flow/e2e/support/` and `e2e/tests/support/`, and
 * Workflow 8D's `expectNoAxeViolations` (`e2e/tests/support/ui-axe.ts`). One tag list, one report
 * line per violation and target, and the exceptions of `e2e/a11y-exceptions.json`. No import: axe
 * (MPL-2.0 test tooling) stays in the suites that run it, and these types are read structurally.
 */

/** The parts of an axe result the reports name (axe-core's `Result`, read structurally). */
export interface AxeViolation {
  readonly id: string;
  readonly impact?: string | null | undefined;
  readonly help: string;
  readonly nodes: readonly { readonly target: readonly unknown[] }[];
}

/**
 * The WCAG 2.0, 2.1 and 2.2 A and AA tags. axe-core 4.14 tags no rule `wcag22a` (its WCAG 2.2
 * rule, target-size, is `wcag22aa`), so that tag would select nothing and is not listed.
 */
export const AXE_WCAG_TAGS: readonly string[] = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];

/** A target as axe gives it: a selector, or a path through frames and shadow roots. */
function selectorOf(target: readonly unknown[]): string {
  if (target.length === 0) {
    return '(no target)';
  }
  return target
    .flatMap((part) => (Array.isArray(part) ? (part as unknown[]) : [part]))
    .map(String)
    .join(' >>> ');
}

/** One line per violation and target: `rule (impact) at target: help`. */
export function axeViolationLines(violations: readonly AxeViolation[]): string[] {
  return violations.flatMap((violation) => {
    const impact = violation.impact ?? 'impact not given';
    const targets = violation.nodes.length === 0 ? [[]] : violation.nodes.map((n) => n.target);
    return targets.map(
      (target) => `${violation.id} (${impact}) at ${selectorOf(target)}: ${violation.help}`,
    );
  });
}

/** The exceptions file, from the repository root. */
export const A11Y_EXCEPTIONS_PATH = 'e2e/a11y-exceptions.json';

/** One exception of `e2e/a11y-exceptions.json`. */
export interface A11yException {
  /** The axe rule id it passes. */
  readonly rule: string;
  /** The one target it passes (a selector as axe reports it); absent, every target. */
  readonly target?: string | undefined;
  /** The page it passes on (the `where` of the call); absent, every page. */
  readonly where?: string | undefined;
  /** Why, with its tracking item. */
  readonly reason: string;
  /** The last day it passes (`YYYY-MM-DD`, UTC); after it, the exception itself fails. */
  readonly expires: string;
}

const EXCEPTION_KEYS: ReadonlySet<string> = new Set([
  'rule',
  'target',
  'where',
  'reason',
  'expires',
]);
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const refuse = (detail: string): never => {
  throw new Error(`${A11Y_EXCEPTIONS_PATH}: ${detail}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, name: string, index: number, max: number): string => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    return refuse(
      `exception ${String(index)}: ${name} must be text of 1 to ${String(max)} characters`,
    );
  }
  return value;
};

/** A real calendar day, `YYYY-MM-DD`. */
function isCalendarDay(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The exceptions of the file's document: `{ "exceptions": [{ rule, target?, where?, reason,
 * expires }] }`, nothing else. A malformed file fails every call, so no exception is read loosely.
 * @throws {Error} naming the file and what is wrong.
 */
export function parseA11yExceptions(document: unknown): A11yException[] {
  if (!isRecord(document) || !Array.isArray(document.exceptions)) {
    return refuse('must be an object with an "exceptions" list');
  }
  const extra = Object.keys(document).filter((key) => key !== 'exceptions' && key !== '$comment');
  if (extra.length > 0) {
    return refuse(`unknown members ${extra.join(', ')}`);
  }
  return document.exceptions.map((item: unknown, index) => {
    if (!isRecord(item)) {
      return refuse(`exception ${String(index)} must be an object`);
    }
    const unknown = Object.keys(item).filter((key) => !EXCEPTION_KEYS.has(key));
    if (unknown.length > 0) {
      return refuse(`exception ${String(index)}: unknown members ${unknown.join(', ')}`);
    }
    const expires = text(item.expires, 'expires', index, 10);
    if (!isCalendarDay(expires)) {
      return refuse(`exception ${String(index)}: expires must be a day, YYYY-MM-DD`);
    }
    return {
      rule: text(item.rule, 'rule', index, 100),
      ...(item.target === undefined ? {} : { target: text(item.target, 'target', index, 500) }),
      ...(item.where === undefined ? {} : { where: text(item.where, 'where', index, 500) }),
      reason: text(item.reason, 'reason', index, 500),
      expires,
    };
  });
}

/** Whether `exception` has passed its last day at `now` (UTC). */
const hasExpired = (exception: A11yException, now: Date): boolean =>
  now.toISOString().slice(0, 10) > exception.expires;

/**
 * The violations no unexpired exception passes, and one line per expired exception: an exception
 * passes its rule, at its target (every target when it names none) and on its page (every page when
 * it names none); a violation with targets left keeps only those.
 */
export function applyA11yExceptions(
  violations: readonly AxeViolation[],
  exceptions: readonly A11yException[],
  context: { readonly now: Date; readonly where: string },
): { violations: AxeViolation[]; expired: string[] } {
  const live = exceptions.filter(
    (exception) =>
      !hasExpired(exception, context.now) &&
      (exception.where === undefined || exception.where === context.where),
  );
  const passes = (rule: string, target: readonly unknown[]) =>
    live.some(
      (exception) =>
        exception.rule === rule &&
        (exception.target === undefined || exception.target === selectorOf(target)),
    );
  const remaining = violations.flatMap((violation) => {
    const nodes = violation.nodes.filter((node) => !passes(violation.id, node.target));
    if (
      nodes.length === violation.nodes.length &&
      !(nodes.length === 0 && passes(violation.id, []))
    ) {
      return [violation];
    }
    return nodes.length === 0 ? [] : [{ ...violation, nodes }];
  });
  return {
    violations: remaining,
    expired: exceptions
      .filter((exception) => hasExpired(exception, context.now))
      .map(
        (exception) =>
          `the exception for ${exception.rule}${exception.target === undefined ? '' : ` at ${exception.target}`} expired on ${exception.expires}: ${exception.reason}`,
      ),
  };
}

/** One incomplete result, as the manual pass reads it: never the HTML or the text. */
export interface AxeIncomplete {
  readonly rule: string;
  readonly impact: string | null;
  readonly targets: readonly string[];
}

/** Each incomplete result's rule, impact and targets, for the manual pass (C171.2). */
export function axeIncompleteSummary(incomplete: readonly AxeViolation[]): AxeIncomplete[] {
  return incomplete.map((result) => ({
    rule: result.id,
    impact: result.impact ?? null,
    targets: result.nodes.map((node) => selectorOf(node.target)),
  }));
}
