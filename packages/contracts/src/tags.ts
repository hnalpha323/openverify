/**
 * Tags in request and response bodies (contract C9). The rules live in `@openverify/core`
 * (`normalizeTags`, `addTag`, `removeTag`); these schemas check the format at the edge.
 */
import {
  MAX_TAGS_PER_OBJECT,
  dedupeTags,
  isValidTag,
  normalizeTag,
  tagKey,
} from '@openverify/core';
import { z } from 'zod';
import { actionBodySchema } from './actions.js';

const TAG_RULE = 'must be 1 to 64 letters, digits, spaces or "_ . : - /" characters';

/** A tag as sent: surrounding spaces are allowed and trimmed by the server. */
export const tagInputSchema = z.string().max(256).refine(isValidTag, TAG_RULE);

/** A list of tags as sent: duplicates (ignoring case) count once, at most 50 remain. */
export const tagListInputSchema = z
  .array(tagInputSchema)
  .max(2 * MAX_TAGS_PER_OBJECT)
  .refine(
    (tags) => dedupeTags(tags).length <= MAX_TAGS_PER_OBJECT,
    `at most ${String(MAX_TAGS_PER_OBJECT)} distinct tags are allowed`,
  );

/** A stored tag: valid and already normalized. */
export const tagSchema = z
  .string()
  .refine((tag) => isValidTag(tag) && normalizeTag(tag) === tag, TAG_RULE);

/** An object's tags: unique ignoring case, at most 50. */
export const tagsSchema = z
  .array(tagSchema)
  .max(MAX_TAGS_PER_OBJECT)
  .refine(
    (tags) => new Set(tags.map(tagKey)).size === tags.length,
    'must not contain the same tag twice, ignoring case',
  );

export const tagMetaSchema = z.strictObject({ 'tag-name': tagInputSchema });
export const tagNamesMetaSchema = z.strictObject({ 'tag-names': tagListInputSchema });

/** `POST /inquiries/:id/add-tag` and `/accounts/:id/add-tag`. */
export const addTagBodySchema = actionBodySchema(tagMetaSchema);
/** `POST /inquiries/:id/remove-tag` and `/accounts/:id/remove-tag`. */
export const removeTagBodySchema = actionBodySchema(tagMetaSchema);
/** `POST /inquiries/:id/set-tags` and `/accounts/:id/set-tags`: replaces the whole list. */
export const setTagsBodySchema = actionBodySchema(tagNamesMetaSchema);
export type TagBody = z.infer<typeof addTagBodySchema>;
export type SetTagsBody = z.infer<typeof setTagsBodySchema>;
