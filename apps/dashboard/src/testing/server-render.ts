/**
 * The forms of a component as the server renders them, before hydration (Workflow 2D F004).
 * A form whose `action` is a function renders React's guard (`javascript:throw …`) plus a script
 * that holds a submission made before hydration and replays it afterwards; a form with only an
 * `onSubmit` handler renders a plain `<form>`, which the browser submits as a GET to the page's
 * own URL, field values in the query string.
 */
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

export interface ServerRenderedForm {
  readonly method: string | null;
  readonly action: string | null;
}

/** The `method` and `action` attributes of every form `element` renders on the server. */
export function serverRenderedForms(element: ReactElement): ServerRenderedForm[] {
  const container = document.createElement('div');
  container.innerHTML = renderToString(element);
  return [...container.querySelectorAll('form')].map((form) => ({
    method: form.getAttribute('method'),
    action: form.getAttribute('action'),
  }));
}

/**
 * Whether submitting the form before hydration keeps its values out of the URL: React holds the
 * submission for its action (its guard URL), or the form posts.
 */
export function submitsSafelyBeforeHydration(form: ServerRenderedForm): boolean {
  return form.action?.startsWith('javascript:') === true || form.method?.toLowerCase() === 'post';
}
