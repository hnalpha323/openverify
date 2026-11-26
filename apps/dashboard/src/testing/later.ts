/**
 * `value`, resolved after a macrotask rather than at once: a stubbed server action that answers
 * the way a real one does, after the browser has had a chance to render. Tests that assert on
 * what the answer changes must then wait for it, so they do not pass only on an idle machine.
 */
export function later<T>(value: T, ms = 10): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(value);
    }, ms);
  });
}
