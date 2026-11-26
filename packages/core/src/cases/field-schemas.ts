/**
 * C130.2 (F37): the case subset of the Phase 7 field schemas. A case refuses `file`, because
 * attachments carry files, and `json`, because Phase 8 shares no compile of a stored schema. It keeps
 * `platform-file` with Phase 7's rule. Everything else is the walker's: the caps, the keys, `never`,
 * the searchable marks and the card guard, which a case version has no way to lift.
 */
import type { FieldProblem } from '../transactions/engine.js';
import type { FieldSchema } from '../transactions/field-schemas.js';
import { childFields, isRecord } from '../transactions/field-tree.js';
import { TRANSACTION_LIMITS } from '../transactions/field-types.js';
import { fieldSchemaProblems } from '../transactions/version-rules.js';

const REFUSED_TYPES: ReadonlySet<string> = new Set(['file', 'json']);

/**
 * The fields a case cannot have, each by its pointer. It walks no deeper than the nesting cap, so a
 * hostile depth costs no stack; {@link caseFieldSchemaProblems} refuses that depth by the cap itself.
 */
export function caseFieldTypeProblems(fieldSchemas: readonly FieldSchema[]): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const visit = (field: FieldSchema, pointer: string, containers: number): void => {
    if (!isRecord(field)) {
      return;
    }
    if (REFUSED_TYPES.has(field.type)) {
      problems.push({ code: 'field_schema_invalid', pointer: `${pointer}/type` });
    }
    if (containers < TRANSACTION_LIMITS.nestingLevels) {
      for (const child of childFields(field, pointer)) {
        visit(child.field, child.pointer, containers + 1);
      }
    }
  };
  fieldSchemas.forEach((field, index) => {
    visit(field, `/field-schemas/${String(index)}`, 0);
  });
  return problems;
}

/** C130.2: the problems of a version's fields, at publish: the walker's, and the case subset's. */
export function caseFieldSchemaProblems(fieldSchemas: readonly FieldSchema[]): FieldProblem[] {
  const problems = caseFieldTypeProblems(fieldSchemas);
  fieldSchemaProblems(fieldSchemas, true, problems);
  return problems;
}
