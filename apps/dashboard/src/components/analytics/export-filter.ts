/**
 * The filters the new-export form offers per type (C166.1): the ones each type needs (a
 * verification type, a list) and a few the list routes take for every type, read from the form into
 * the route's own names. Dates are UTC days: the start included, the end the day after the last one.
 */
import { VERIFICATION_TYPES, type ExportObjectType } from '@openverify/core';

export const EXPORT_VERIFICATION_TYPES: readonly string[] = VERIFICATION_TYPES.map((type) =>
  type.replaceAll('_', '-'),
);

/** Whether the type's rows can be chosen by creation day (its list route takes the range). */
export const takesCreatedRange = (type: ExportObjectType) => type !== 'lists';

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

function midnight(day: string | null, plusDays = 0): string | undefined {
  if (day === null || !DAY.test(day)) {
    return undefined;
  }
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(time) ? undefined : new Date(time + plusDays * 86_400_000).toISOString();
}

const text = (formData: FormData, name: string): string | null => {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

/** The export's `filter`, as the type's list route names it; empty values are left out. */
export function exportFilterOf(type: ExportObjectType, formData: FormData): Record<string, string> {
  const filter: Record<string, string> = {};
  const set = (name: string, value: string | null | undefined) => {
    if (value !== null && value !== undefined) {
      filter[name] = value;
    }
  };
  if (type === 'verifications') {
    set('filter[type]', text(formData, 'verification-type'));
  }
  if (type === 'lists') {
    set('filter[list-id]', text(formData, 'list-id'));
  }
  if (type === 'inquiries' || type === 'verifications') {
    set('filter[status]', text(formData, 'status'));
  }
  if (takesCreatedRange(type)) {
    set('filter[created-at-start]', midnight(text(formData, 'created-from')));
    set('filter[created-at-end]', midnight(text(formData, 'created-to'), 1));
  }
  return filter;
}
