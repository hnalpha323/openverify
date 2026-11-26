/**
 * The length limit of each query member, read from the contract's own schema (owner decision 24
 * after Workflow 6B, R014): the create report form gives every input its member's `max`, so a
 * 500-character business website is typed whole and a 20-character postal code is capped at 20.
 * A member whose schema states no length (a pattern decides it: an LEI, an IMO number, an E.164
 * number, a date) gets no limit in the browser; the API checks every value.
 */
import { REPORT_QUERY_SCHEMAS } from '@openverify/contracts';
import type { ReportType } from '@openverify/core';
import { z } from 'zod';

/** `schema` without its optional and nullable wrappers. */
function unwrapped(schema: z.ZodType): z.ZodType {
  let current = schema;
  while (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
    current = current.unwrap() as z.ZodType;
  }
  return current;
}

/**
 * The `max` of the query member at `path` of `type`'s query (`['website']`, or
 * `['additional-names', 'name-first']` for a part of an additional name), or `undefined` when the
 * member states none or the query has no such member.
 */
export function queryMaxLength(type: ReportType, path: readonly string[]): number | undefined {
  let schema: z.ZodType = REPORT_QUERY_SCHEMAS[type];
  for (const key of path) {
    let current = unwrapped(schema);
    if (current instanceof z.ZodArray) {
      current = unwrapped(current.element as z.ZodType);
    }
    if (!(current instanceof z.ZodObject) || !Object.hasOwn(current.shape, key)) {
      return undefined;
    }
    schema = current.shape[key] as z.ZodType;
  }
  const member = unwrapped(schema);
  return member instanceof z.ZodString && member.maxLength !== null ? member.maxLength : undefined;
}
