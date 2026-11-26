export type ClassValue = string | false | null | undefined;

/** Joins the truthy class names with single spaces. */
export function cx(...values: readonly ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
