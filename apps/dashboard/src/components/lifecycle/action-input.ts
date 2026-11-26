/**
 * Form input helpers of the lifecycle server actions: values typed as text (a list of tags, a
 * JSON document) turned into what the contract's request schemas validate.
 */
import 'server-only';
import { idSchema, type IdPrefix } from '@openverify/contracts';
import { ActionInputError } from '../../lib/api/action';

/** Tags typed one per line (commas also separate them: no tag contains one). */
export function tagNamesOf(text: string | undefined): string[] {
  return (text ?? '')
    .split(/[\n,]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

/**
 * The JSON documents typed into a form, by the request's JSON Pointer of each.
 * @throws {ActionInputError} naming every document that is not JSON, at its pointer.
 */
export function jsonDocumentsOf<Pointer extends string>(
  texts: Readonly<Record<Pointer, string | undefined>>,
): Record<Pointer, unknown> {
  const documents = {} as Record<Pointer, unknown>;
  const errors: { pointer: string; detail: string }[] = [];
  for (const pointer of Object.keys(texts) as Pointer[]) {
    try {
      documents[pointer] = JSON.parse(texts[pointer] ?? '') as unknown;
    } catch {
      errors.push({ pointer, detail: 'is not valid JSON' });
    }
  }
  if (errors.length > 0) {
    throw new ActionInputError({
      title: 'Check the values you entered',
      detail:
        errors.length === 1
          ? 'A document is not valid JSON.'
          : 'Some documents are not valid JSON.',
      errors,
    });
  }
  return documents;
}

/**
 * The JSON document typed into the form field of `pointer` (the request's JSON Pointer).
 * @throws {ActionInputError} when it is not JSON, with the error at `pointer`.
 */
export function jsonOf(text: string | undefined, pointer: string): unknown {
  return jsonDocumentsOf({ [pointer]: text })[pointer];
}

/** A whole number typed into a form, `undefined` when blank; anything else is kept for the schema. */
export function optionalIntegerOf(text: string | undefined): number | string | undefined {
  if (text === undefined || text.trim() === '') {
    return undefined;
  }
  return /^-?\d+$/.test(text.trim()) ? Number(text.trim()) : text;
}

/**
 * IDs typed into one field, separated by commas, spaces or new lines.
 * @throws {ActionInputError} at `pointer`, saying what to enter, when there are none, more than
 *   `max`, or one is not an ID of `prefix`.
 */
export function idListOf(
  text: string | undefined,
  { prefix, max, pointer, noun }: { prefix: IdPrefix; max: number; pointer: string; noun: string },
): string[] {
  const ids = (text ?? '').split(/[\s,]+/).filter((id) => id !== '');
  const schema = idSchema(prefix);
  if (ids.length === 0 || ids.length > max || !ids.every((id) => schema.safeParse(id).success)) {
    throw new ActionInputError({
      title: 'Check the values you entered',
      errors: [
        {
          pointer,
          detail: `Enter 1 to ${String(max)} ${noun} IDs, such as ${prefix}_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z.`,
        },
      ],
    });
  }
  return ids;
}
