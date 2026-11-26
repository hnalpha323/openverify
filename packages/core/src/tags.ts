/**
 * Tags on inquiries and accounts (contract C9):
 * - Unicode letters (with their combining marks), decimal digits, space and `_ . : - /`;
 * - 1 to 64 characters (code points) after trimming;
 * - case is preserved, but an object's tags are unique ignoring case;
 * - at most 50 per object.
 *
 * A comma is never part of a tag, because list filters use it to separate values.
 */
import { DomainError } from './errors.js';

export const MAX_TAG_LENGTH = 64;
export const MAX_TAGS_PER_OBJECT = 50;

/** In a `u` pattern the quantifier counts code points, which is how Postgres counts length. */
const TAG_PATTERN = new RegExp(`^[\\p{L}\\p{M}\\p{Nd} _.:/-]{1,${String(MAX_TAG_LENGTH)}}$`, 'u');

/** A tag failed the C9 format. The message never repeats the tag, which may be PII. */
export class InvalidTagError extends DomainError {
  constructor() {
    super(
      'invalid_tag',
      `Tags are 1 to ${String(MAX_TAG_LENGTH)} letters, digits, spaces or "_ . : - /" characters`,
    );
  }
}

/** An object would carry more than `MAX_TAGS_PER_OBJECT` distinct tags. */
export class TooManyTagsError extends DomainError {
  readonly limit = MAX_TAGS_PER_OBJECT;

  constructor() {
    super('too_many_tags', `An object can carry at most ${String(MAX_TAGS_PER_OBJECT)} tags`);
  }
}

/** The stored form of a tag: Unicode NFC, without surrounding spaces. */
export function normalizeTag(tag: string): string {
  return tag.normalize('NFC').trim();
}

/** Whether `tag` is valid once normalized. */
export function isValidTag(tag: string): boolean {
  return TAG_PATTERN.test(normalizeTag(tag));
}

/**
 * The normalized tag.
 * @throws {InvalidTagError} when the tag is not valid.
 */
export function validateTag(tag: string): string {
  if (!isValidTag(tag)) {
    throw new InvalidTagError();
  }
  return normalizeTag(tag);
}

/**
 * The key two tags are compared by: equal keys are the same tag. Upper- then lower-casing
 * folds more than lower-casing alone (`Straße` and `STRASSE` are one tag).
 */
export function tagKey(tag: string): string {
  return normalizeTag(tag).toUpperCase().toLowerCase();
}

export function hasTag(tags: readonly string[], tag: string): boolean {
  const key = tagKey(tag);
  return tags.some((existing) => tagKey(existing) === key);
}

/** Normalizes every tag and keeps the first spelling of each, in order. Does not validate. */
export function dedupeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const key = tagKey(tag);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalizeTag(tag));
    }
  }
  return result;
}

/**
 * The tag list `set-tags` stores: every tag validated and normalized, duplicates removed.
 * @throws {InvalidTagError} when any tag is not valid.
 * @throws {TooManyTagsError} when more than 50 distinct tags remain.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const result = dedupeTags(tags.map(validateTag));
  if (result.length > MAX_TAGS_PER_OBJECT) {
    throw new TooManyTagsError();
  }
  return result;
}

/**
 * `add-tag`: the list with `tag` appended, or an unchanged copy when it is already present.
 * @throws {InvalidTagError} when the tag is not valid.
 * @throws {TooManyTagsError} when the object already has 50 tags.
 */
export function addTag(tags: readonly string[], tag: string): string[] {
  const normalized = validateTag(tag);
  if (hasTag(tags, normalized)) {
    return [...tags];
  }
  if (tags.length >= MAX_TAGS_PER_OBJECT) {
    throw new TooManyTagsError();
  }
  return [...tags, normalized];
}

/** `remove-tag`: the list without `tag`, ignoring case. Removing an absent tag is a no-op. */
export function removeTag(tags: readonly string[], tag: string): string[] {
  const key = tagKey(tag);
  return tags.filter((existing) => tagKey(existing) !== key);
}
