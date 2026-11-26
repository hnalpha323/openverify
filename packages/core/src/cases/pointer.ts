/** RFC 6901: one token of a JSON Pointer, so a problem can point at any key without quoting it. */
export const pointerToken = (value: string | number): string =>
  String(value).replaceAll('~', '~0').replaceAll('/', '~1');
