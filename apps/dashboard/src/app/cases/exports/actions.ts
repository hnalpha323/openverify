'use server';

/**
 * Asking for a case export (C138.1, C142.1), with `cases:export`, which reviewers lack (decision 68).
 * The export takes the cases the filters chosen select, or every case the caller sees, as CSV or JSON.
 * Personal data (the cases' fields) is included only with `pii:view` and after the form's explicit
 * confirmation; otherwise it is refused before the API is asked. The file is written by a job, kept
 * 24 hours, and read and downloaded by its creator alone.
 */
import { createCaseExportBodySchema } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { ActionInputError, formString, parseInput } from '../../../lib/api/action';
import { runCaseAction } from '../../../lib/api/cases';

const ids = (value: string | undefined) =>
  value === undefined || value === '' ? undefined : [value];

/** The list filters the form chose, without their `filter[...]` wrapper; none: every case. */
function filterOf(formData: FormData): Record<string, unknown> | undefined {
  const filter = Object.fromEntries(
    Object.entries({
      'case-template-id': ids(formString(formData, 'template')),
      'case-queue-id': ids(formString(formData, 'queue')),
      'status-category': ids(formString(formData, 'category')),
      'sla-state': ids(formString(formData, 'sla')),
      status: ids(formString(formData, 'status')),
    }).filter(([, value]) => value !== undefined),
  );
  return Object.keys(filter).length === 0 ? undefined : filter;
}

/** `POST /case-exports` (202): answers the export's id. */
export async function createCaseExport(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const personal = formData.get('include-personal-data') === 'on';
  const permissions: Permission[] = ['cases:export', ...(personal ? (['pii:view'] as const) : [])];
  return runCaseAction({ permissions, environmentForm: formData }, async ({ api }) => {
    if (personal && formString(formData, 'personal-data-confirmed') !== 'true') {
      throw new ActionInputError({
        title: 'Confirm the personal data first',
        errors: [
          {
            pointer: '/data/attributes/include-personal-data',
            detail: 'Including personal data needs your confirmation.',
          },
        ],
      });
    }
    const filter = filterOf(formData);
    const body = parseInput(createCaseExportBodySchema, {
      data: {
        attributes: {
          format: formString(formData, 'format'),
          'include-personal-data': personal,
          ...(filter === undefined ? {} : { filter }),
        },
      },
    });
    const { data } = await api.caseExports.create(body.data.attributes);
    revalidatePath('/cases/exports');
    return { id: data.id };
  });
}
