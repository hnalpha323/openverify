/**
 * A contest route typed in a form (C128.3): an `https:` URL, a contact, or both; both empty is no
 * route (`null`). Checked by the contract's `contestRouteSchema`, each refusal at its pointer.
 */
import { contestRouteSchema, type ContestRoute } from '@openverify/contracts';
import { ActionInputError, formString } from './api/action';

export function contestRouteFromForm(formData: FormData, pointer: string): ContestRoute | null {
  const url = formString(formData, 'contest-url') ?? '';
  const contact = formString(formData, 'contest-contact') ?? '';
  if (url === '' && contact === '') {
    return null;
  }
  const parsed = contestRouteSchema.safeParse({
    ...(url === '' ? {} : { url }),
    ...(contact === '' ? {} : { contact }),
  });
  if (parsed.success) {
    return parsed.data;
  }
  throw new ActionInputError({
    title: 'Check the values you entered',
    detail: 'The contest route is not valid.',
    errors: parsed.error.issues.map((issue) => ({
      pointer: [pointer, ...issue.path.map(String)].join('/'),
      detail: issue.message,
    })),
  });
}
