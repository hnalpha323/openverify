/**
 * Owner decision 20 after Workflow 7B (Workflow 9B): how the graph-query job, a rerun and the
 * expansion service know an expansion by its stored start, a single start value no parameter
 * bound. Its own module, so the query service and the job read it without importing the expansion
 * service (which imports them).
 */
import { blindIndexKeyId } from '@openverify/db';
import { graphIndexKey } from './keys.js';

interface StoredStart {
  kind: number;
  keyId?: string;
  account?: boolean;
  start?: boolean;
  parameter?: string;
}

/** Whether a stored node map's start is an expansion's: a start value bound by no parameter. */
export function isExpansionStart(nodeMap: Readonly<Record<string, unknown>>): boolean {
  const starts = Object.values(nodeMap).filter(
    (entry) => (entry as Partial<StoredStart> | null)?.start === true,
  ) as Partial<StoredStart>[];
  return (
    starts.length === 1 &&
    starts[0]?.account !== true &&
    (starts[0]?.parameter === undefined || starts[0].parameter === '')
  );
}

/**
 * An expansion's start (Workflow 9B, for the graph-query job): its kind's code, and whether its key
 * was made under a blind-index key other than this process's (`graphIndexKey`), whose kind then
 * reads as not indexed. Null when the map holds no single unbound start value.
 */
export function expansionStartOf(
  nodeMap: Readonly<Record<string, unknown>>,
): { kind: number; retired: boolean } | null {
  if (!isExpansionStart(nodeMap)) {
    return null;
  }
  const start = Object.values(nodeMap).find(
    (entry) => (entry as Partial<StoredStart> | null)?.start === true,
  ) as Partial<StoredStart>;
  if (typeof start.kind !== 'number') {
    return null;
  }
  const keyId = start.keyId ?? '';
  const key = graphIndexKey();
  return {
    kind: start.kind,
    retired: keyId !== '' && (key === null || keyId !== blindIndexKeyId(key)),
  };
}
