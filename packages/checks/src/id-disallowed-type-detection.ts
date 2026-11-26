import { idClassSchema, type CheckResult } from '@openverify/core';
import { z } from 'zod';
import { checkResult, parseCheckConfig, presentText } from './result.js';

const CHECK_ID = 'id_disallowed_type_detection';

/**
 * Internal options. Templates set the verification type's `allowed-id-classes` (C11), or the
 * flow step its `allowedIdClasses`; the evaluator passes whichever applies (C29.5).
 */
export const idDisallowedTypeOptionsSchema = z.strictObject({
  /** When set, only these ID classes pass. */
  allowedIdClasses: z.array(idClassSchema).min(1).optional(),
  /** ID classes that always fail. */
  disallowedIdClasses: z.array(idClassSchema).min(1).optional(),
});
export type IdDisallowedTypeOptions = z.input<typeof idDisallowedTypeOptionsSchema>;

export interface IdDisallowedTypeInput {
  /** Classified ID class, e.g. `passport` or `drivers_license`. */
  idClass?: string | null | undefined;
  /** Whether the document itself established it (C30.2); defaults to true when given. */
  established?: boolean | undefined;
}

/**
 * `id_disallowed_type_detection`: the ID class must be on the allowlist (if set) and not on the
 * denylist (if set). Without a policy an established class passes (C29.6). A class the document
 * did not establish (one the user picked, C30.2), none, or an unknown one leaves the check
 * without evidence (`input_missing`).
 */
export function idDisallowedTypeDetection(
  input: IdDisallowedTypeInput,
  options: IdDisallowedTypeOptions,
): CheckResult {
  const { allowedIdClasses, disallowedIdClasses } = parseCheckConfig(
    CHECK_ID,
    idDisallowedTypeOptionsSchema,
    options,
  );
  const thresholds = {
    ...(allowedIdClasses === undefined ? {} : { 'allowed-id-classes': [...allowedIdClasses] }),
    ...(disallowedIdClasses === undefined
      ? {}
      : { 'disallowed-id-classes': [...disallowedIdClasses] }),
  };
  const raw = presentText(input.idClass);
  const parsed = raw === null ? null : idClassSchema.safeParse(raw);
  if (input.established === false || parsed?.success !== true) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, { thresholds });
  }
  const idClass = parsed.data;
  const reasons: string[] = [];
  if (allowedIdClasses && !allowedIdClasses.includes(idClass)) {
    reasons.push('id_class_not_allowed');
  }
  if (disallowedIdClasses?.includes(idClass)) {
    reasons.push('id_class_disallowed');
  }
  return checkResult(
    CHECK_ID,
    reasons.length > 0 ? 'failed' : 'passed',
    reasons,
    { idClass },
    { thresholds },
  );
}
