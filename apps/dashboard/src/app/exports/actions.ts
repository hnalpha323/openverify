'use server';

/**
 * Asking for an export (C166.1, C166.2), with the type's `:export` permission (admin's alone by
 * default). The rows are those of the filters chosen, or of a saved view of the caller's; personal
 * columns are included only with `pii:view` and after the form's explicit confirmation, else they
 * are masked. The filter's values go to the API in the body, never in a URL; the export records only
 * the filter's keys. A refusal (`export_too_large` past 50,000 rows, the `exports` policy) is shown
 * in words; nothing is ever cut short.
 */
import { createExportBodySchema } from '@openverify/contracts';
import {
  EXPORT_OBJECT_TYPES,
  EXPORT_PERMISSIONS,
  type ExportObjectType,
  type Permission,
} from '@openverify/core';
import { revalidatePath } from 'next/cache';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, parseInput, runAction } from '../../lib/api/action';
import { createExport } from '../../lib/api/exports';
import { exportFilterOf } from '../../components/analytics/export-filter';

const isType = (value: string | undefined): value is ExportObjectType =>
  (EXPORT_OBJECT_TYPES as readonly string[]).includes(value ?? '');

/** `POST /exports` (202): answers the export's id. */
export async function createExportAction(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const type = formString(formData, 'object-type');
  const personal = formData.get('include-personal-data') === 'on';
  const permissions: Permission[] = [
    ...(isType(type) ? [EXPORT_PERMISSIONS[type]] : []),
    ...(personal ? (['pii:view'] as const) : []),
  ];
  return runAction({ permissions, environmentForm: formData }, async () => {
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
    const view = formString(formData, 'saved-view-id');
    const filter = isType(type) ? exportFilterOf(type, formData) : {};
    const body = parseInput(createExportBodySchema, {
      data: {
        attributes: {
          'object-type': type,
          format: 'csv',
          'include-personal-data': personal,
          ...(view === undefined || view === '' ? { filter } : { 'saved-view-id': view }),
        },
      },
    });
    const { data } = await createExport(body.data.attributes);
    revalidatePath('/exports');
    return { id: data.id };
  });
}
