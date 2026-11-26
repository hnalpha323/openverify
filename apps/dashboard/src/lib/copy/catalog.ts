/**
 * The console's typed English catalog (decision 33; C155.9): Phase 9's new console strings, and the
 * editor's library strings, live in modules under `lib/copy/`, so translating the console later is
 * a data change. Each area owns one module, `lib/copy/<area>.ts`, whose catalog is made with
 * `defineCopy`; a message that takes values is a function of them, and returns plain text (React
 * renders it as text, never as markup).
 */

/** One message: plain text, or plain text made from the values it is given. */
export type CopyMessage = string | ((...values: never[]) => string);

/** A catalog: messages, and nested groups of them. */
export interface CopyCatalog {
  readonly [key: string]: CopyMessage | CopyCatalog;
}

/** The catalog as given, typed exactly, frozen at every depth. */
export function defineCopy<const Catalog extends CopyCatalog>(catalog: Catalog): Catalog {
  for (const value of Object.values(catalog)) {
    if (typeof value === 'object') {
      defineCopy(value);
    }
  }
  return Object.freeze(catalog);
}
