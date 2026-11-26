/**
 * Test-only: a condition typer with the shape and the rules of `@openverify/workflow-engine`'s
 * `typeFlowCondition` that the analyses need (that package depends on this one, so the tests here
 * cannot import it; its own suite tests the real one). It resolves each `var` against the concrete
 * paths (`path_unknown`), marks reads nullable and PII, refuses a nullable path under `!==` or as a
 * boolean (`nullable_in_boolean_position`) and a PII path compared with a string literal
 * (`pii_literal_in_condition`), and says whether a nullable path is read outside `=== null`.
 */
import type { ConditionTyper, FlowConditionPathInput } from './analyses.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const testTyper: ConditionTyper = (condition, paths) => {
  const known = new Map<string, FlowConditionPathInput>(paths.map((path) => [path.path, path]));
  const issues: { pointer: string; code: string; detail: string }[] = [];
  const reads: { path: string; nullable: boolean; pii: boolean; pointer: string }[] = [];
  let readsNullable = false;
  const walk = (
    node: unknown,
    pointer: string,
    parent: string | null,
    siblings: unknown[],
  ): void => {
    if (Array.isArray(node)) {
      node.forEach((item: unknown, index) => {
        walk(item, `${pointer}/${String(index)}`, parent, node as unknown[]);
      });
      return;
    }
    if (!isRecord(node)) return;
    const [operator] = Object.keys(node);
    if (operator === undefined) return;
    const raw = node[operator];
    const at = `${pointer}/${operator.replaceAll('/', '~1')}`;
    if (operator !== 'var') {
      walk(raw, at, operator, Array.isArray(raw) ? (raw as unknown[]) : [raw]);
      return;
    }
    const path = String(raw);
    const found = known.get(path);
    if (found === undefined) {
      issues.push({ pointer: at, code: 'path_unknown', detail: 'unknown' });
      return;
    }
    reads.push({ path, nullable: found.nullable, pii: found.pii, pointer: at });
    const nullTest = (parent === '===' || parent === '!==') && siblings.includes(null);
    if (found.nullable && !nullTest) readsNullable = true;
    if (found.nullable && (parent === '!==' || parent === '!' || parent === '!!') && !nullTest) {
      issues.push({ pointer: at, code: 'nullable_in_boolean_position', detail: 'nullable' });
    }
    if (
      found.pii &&
      (parent === '===' || parent === '==') &&
      siblings.some((s) => typeof s === 'string')
    ) {
      issues.push({ pointer: at, code: 'pii_literal_in_condition', detail: 'pii' });
    }
  };
  walk(condition, '', null, []);
  return { issues, reads, readsNullable };
};
