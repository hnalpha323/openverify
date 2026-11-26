/** How the engine reads a stored field schema: its `config`, and the fields inside it. */
import type { FieldSchema } from './field-schemas.js';

export type FieldConfig = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** RFC 6901. */
export function escapePointerToken(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

export function configOf(field: FieldSchema): FieldConfig {
  return field.config ?? {};
}

/** The fields one level down, each with its pointer relative to `pointer`. */
export function childFields(
  field: FieldSchema,
  pointer: string,
): { readonly field: FieldSchema; readonly pointer: string }[] {
  const config: unknown = field.config;
  if (!isRecord(config)) {
    return [];
  }
  if (field.type === 'array' && isRecord(config['item-schema'])) {
    return [
      { field: config['item-schema'] as FieldSchema, pointer: `${pointer}/config/item-schema` },
    ];
  }
  const items = config['item-schemas'];
  if (field.type === 'hash' && Array.isArray(items)) {
    return (items as FieldSchema[]).map((child, index) => ({
      field: child,
      pointer: `${pointer}/config/item-schemas/${String(index)}`,
    }));
  }
  return [];
}
