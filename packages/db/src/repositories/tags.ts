/**
 * C9 tags on inquiries and accounts: case is preserved, but tags are unique per object
 * ignoring case, and an object holds at most 50. Repositories apply these operations to
 * the row's tags under a row lock; the database checks the same rules as a backstop
 * (`openverify_tags_valid`). The character set is checked by the API.
 */

/** C9: at most 50 tags per object. */
export const MAX_TAGS = 50;

/** The operation would leave an object with more than {@link MAX_TAGS} tags. */
export class TagLimitError extends Error {
  override name = 'TagLimitError';
  readonly code = 'tag_limit';

  constructor() {
    super(`an object holds at most ${String(MAX_TAGS)} tags`);
  }
}

/** The record after a tag operation, and whether its tags changed. */
export interface TagUpdate<T> {
  record: T;
  changed: boolean;
}

/** C9 `add-tag`, `remove-tag` and `set-tags`. */
export type TagOperation =
  | { kind: 'add'; tag: string }
  | { kind: 'remove'; tag: string }
  | { kind: 'set'; tags: readonly string[] };

const sameTag = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Removes case-insensitive duplicates, keeping the first spelling of each tag. */
export function uniqueTags(tags: readonly string[]): string[] {
  const unique: string[] = [];
  for (const tag of tags) {
    if (!unique.some((kept) => sameTag(kept, tag))) {
      unique.push(tag);
    }
  }
  return unique;
}

/**
 * The tags after `operation`, and whether they changed.
 * @throws {TagLimitError} when the result would hold more than 50 tags.
 */
export function applyTagOperation(
  current: readonly string[],
  operation: TagOperation,
): { tags: string[]; changed: boolean } {
  let tags: string[];
  switch (operation.kind) {
    case 'add':
      tags = current.some((tag) => sameTag(tag, operation.tag))
        ? [...current]
        : [...current, operation.tag];
      break;
    case 'remove':
      tags = current.filter((tag) => !sameTag(tag, operation.tag));
      break;
    case 'set':
      tags = uniqueTags(operation.tags);
      break;
  }
  if (tags.length > MAX_TAGS) {
    throw new TagLimitError();
  }
  const changed =
    tags.length !== current.length || tags.some((tag, index) => tag !== current[index]);
  return { tags, changed };
}
