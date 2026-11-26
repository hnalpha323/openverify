/**
 * C172.1-C172.4 (Workflow 9B, `api-cases-reports`; contracts B35, foundation-9b C2): a case template
 * version's `layout`, `checklists`, `preset-comments` and a status's `requires-fields`, as the
 * template service stores, serves and publishes them.
 *
 * - **Stored** in `case_template_versions.layout`, `checklists` and `preset_comments`; a status's
 *   `requires-fields` stays inside `statuses`. A version that never set them reads `null`, `[]` and
 *   `[]` (the default layout, no checklist, no preset comment).
 * - **Published** only when every name they hold is the version's and the publisher's (each refusal
 *   by pointer, `case_template_invalid`, K8-27): a layout module that the version's `layout-modules`
 *   offers (`layout_module_unknown`) and whose `required-permissions` the publisher holds
 *   (`layout_module_not_permitted`, C172.1: a publisher never lays out a module they may not see);
 *   a checklist item's `required-for-statuses` naming the version's statuses
 *   (`checklist_status_unknown`, C172.2); a status's `requires-fields` naming the version's
 *   top-level fields (`required_field_unknown`, C172.3). Keys only: no problem names a value.
 */
import type {
  CaseChecklists,
  CaseLayout,
  CasePresetComments,
  CaseStatusDefinitionResource,
} from '@openverify/contracts';
import type { CaseLayoutModule, FieldSchema, Permission } from '@openverify/core';
import type { CaseTemplateVersionRow } from '@openverify/db';
import type { ProblemFieldError } from '../../../errors.js';
import { DEFAULT_LAYOUT_MODULES } from '../resources.js';

const ATTRIBUTES = '/data/attributes';

/** The C172 members of a stored version, as the resource serves them. */
export interface VersionCompletionMembers {
  layout: CaseLayout | null;
  checklists: CaseChecklists;
  presetComments: CasePresetComments;
}

/** The members a version holds; a version from before Phase 9 holds none. */
export function versionCompletionMembers(row: CaseTemplateVersionRow): VersionCompletionMembers {
  return {
    layout: (row.layout as CaseLayout | null | undefined) ?? null,
    checklists: (row.checklists as CaseChecklists | undefined) ?? [],
    presetComments: (row.presetComments as CasePresetComments | undefined) ?? [],
  };
}

/** A stored status's `requires-fields`; empty when it names none. */
export function requiredFieldsOf(status: unknown): readonly string[] {
  const fields = (status as { 'requires-fields'?: unknown } | null)?.['requires-fields'];
  return Array.isArray(fields) ? fields.filter((key): key is string => typeof key === 'string') : [];
}

/** A status as served: Phase 8's definition, and `requires-fields` when the status names any. */
export function servedStatus(
  definition: CaseStatusDefinitionResource,
  stored: unknown,
): CaseStatusDefinitionResource {
  const fields = requiredFieldsOf(stored);
  return fields.length === 0 ? definition : { ...definition, 'requires-fields': [...fields] };
}

/** The modules a version offers: its own `layout-modules`, or the default layout's. */
function offeredModules(
  row: CaseTemplateVersionRow,
): ReadonlyMap<string, readonly Permission[]> {
  const modules =
    (row.layoutModules as
      | { key: CaseLayoutModule; 'required-permissions': readonly Permission[] }[]
      | null) ?? DEFAULT_LAYOUT_MODULES;
  return new Map(modules.map((module) => [module.key, module['required-permissions']]));
}

const at = (pointer: string, code: string, detail: string): ProblemFieldError => ({
  location: 'body',
  pointer: `${ATTRIBUTES}${pointer}`,
  detail,
  code,
});

/**
 * What keeps a draft's C172 members from being published by a principal holding `publisher`; empty
 * when nothing does. Each error names a pointer and a code, never a value.
 */
export function versionCompletionProblems(
  row: CaseTemplateVersionRow,
  publisher: ReadonlySet<Permission>,
): ProblemFieldError[] {
  const { layout, checklists } = versionCompletionMembers(row);
  const errors: ProblemFieldError[] = [];
  const offered = offeredModules(row);
  for (const [index, module] of (layout?.modules ?? []).entries()) {
    const required = offered.get(module.key);
    const pointer = `/layout/modules/${String(index)}/key`;
    if (required === undefined) {
      errors.push(
        at(pointer, 'layout_module_unknown', 'The version’s layout-modules do not offer it.'),
      );
    } else if (!required.every((permission) => publisher.has(permission))) {
      errors.push(
        at(
          pointer,
          'layout_module_not_permitted',
          'You do not hold the permissions this module needs, so you cannot lay it out.',
        ),
      );
    }
  }
  const statuses = new Set(row.statuses.map((status) => (status as { key: string }).key));
  for (const [c, checklist] of checklists.entries()) {
    for (const [i, item] of checklist.items.entries()) {
      for (const [s, key] of item['required-for-statuses'].entries()) {
        if (!statuses.has(key)) {
          errors.push(
            at(
              `/checklists/${String(c)}/items/${String(i)}/required-for-statuses/${String(s)}`,
              'checklist_status_unknown',
              'Names no status of this version.',
            ),
          );
        }
      }
    }
  }
  const fields = new Set((row.fieldSchemas as FieldSchema[]).map(({ key }) => key));
  for (const [index, status] of row.statuses.entries()) {
    for (const [f, key] of requiredFieldsOf(status).entries()) {
      if (!fields.has(key)) {
        errors.push(
          at(
            `/statuses/${String(index)}/requires-fields/${String(f)}`,
            'required_field_unknown',
            'Names no field of this version.',
          ),
        );
      }
    }
  }
  return errors;
}
