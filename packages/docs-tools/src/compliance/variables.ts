/**
 * Rule 22 for the guide: every `OPENVERIFY_` variable a page names is one
 * `apps/api/src/config-registry.ts` holds (an exact entry, a pattern entry's prefix, or a secret's
 * `_FILE` form).
 */
import { CONFIG_REGISTRY, isPatternEntry } from '../../../../apps/api/src/config-registry.js';
import type { CheckFinding } from '../types.js';

const EXACT = new Map(
  CONFIG_REGISTRY.filter((entry) => !isPatternEntry(entry)).map((entry) => [entry.name, entry]),
);
const PREFIXES = CONFIG_REGISTRY.flatMap((entry) =>
  entry.prefix === undefined ? [] : [entry.prefix],
);

/** Whether `name` is a variable the registry holds. */
export function isRegisteredVariable(name: string): boolean {
  if (EXACT.has(name) || PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return true;
  }
  const base = name.endsWith('_FILE') ? EXACT.get(name.slice(0, -'_FILE'.length)) : undefined;
  return base?.fileForm === true;
}

/** The unregistered variables one page names. */
export function variableFindings(path: string, text: string): readonly CheckFinding[] {
  const names = new Set([...text.matchAll(/\bOPENVERIFY_[A-Z0-9_]+\b/g)].map((match) => match[0]));
  return [...names]
    .filter((name) => !isRegisteredVariable(name))
    .map((name) => ({
      rule: 'compliance-variable',
      path,
      message: `names ${name}, which apps/api/src/config-registry.ts does not hold (rule 22)`,
      severity: 'error' as const,
    }));
}
