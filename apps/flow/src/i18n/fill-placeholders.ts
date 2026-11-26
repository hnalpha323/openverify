/**
 * Fills `{{name}}` placeholders of a message that came through `translateKey`, which never
 * interpolates. A message with a placeholder that has no value cannot be shown as written.
 */

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** `text` with each `{{name}}` replaced by `values[name]`, or `null` when one has no value. */
export function fillPlaceholders(
  text: string,
  values: Readonly<Record<string, string | number>>,
): string | null {
  const missing: string[] = [];
  const filled = text.replace(PLACEHOLDER, (placeholder, name: string) => {
    if (!Object.hasOwn(values, name)) {
      missing.push(name);
      return placeholder;
    }
    return String(values[name]);
  });
  return missing.length === 0 ? filled : null;
}
