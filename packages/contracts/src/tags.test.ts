import { describe, expect, it } from 'vitest';
import {
  addTagBodySchema,
  removeTagBodySchema,
  setTagsBodySchema,
  tagInputSchema,
  tagListInputSchema,
  tagSchema,
  tagsSchema,
} from './tags.js';

const many = (count: number) => Array.from({ length: count }, (_, index) => `t${String(index)}`);

describe('tag input (C9)', () => {
  it('accepts a valid tag, also with surrounding spaces the server trims', () => {
    expect(tagInputSchema.safeParse('High Risk').success).toBe(true);
    expect(tagInputSchema.safeParse('  vip ').success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['a comma', 'a,b'],
    ['65 characters', 'x'.repeat(65)],
    ['an overlong padded value', `${' '.repeat(300)}vip`],
  ])('rejects %s', (_name, tag) => {
    expect(tagInputSchema.safeParse(tag).success).toBe(false);
  });

  it('allows a list of up to 50 distinct tags, duplicates counted once', () => {
    expect(tagListInputSchema.safeParse([]).success).toBe(true);
    expect(tagListInputSchema.safeParse(many(50)).success).toBe(true);
    expect(tagListInputSchema.safeParse([...many(50), 'T0']).success).toBe(true);
    expect(tagListInputSchema.safeParse(many(51)).success).toBe(false);
    expect(tagListInputSchema.safeParse(many(101)).success).toBe(false);
    expect(tagListInputSchema.safeParse(['ok', 'not ok!']).success).toBe(false);
  });
});

describe('stored tags (responses)', () => {
  it('are normalized', () => {
    expect(tagSchema.safeParse('vip').success).toBe(true);
    expect(tagSchema.safeParse(' vip').success).toBe(false);
    expect(tagSchema.safeParse('Revisión').success).toBe(false);
  });

  it('are unique ignoring case, at most 50', () => {
    expect(tagsSchema.safeParse(['VIP', 'gold']).success).toBe(true);
    expect(tagsSchema.safeParse(['VIP', 'vip']).success).toBe(false);
    expect(tagsSchema.safeParse(many(51)).success).toBe(false);
  });
});

describe('tag action bodies (C10, C13)', () => {
  it('add or remove one tag', () => {
    const body = { meta: { 'tag-name': 'vip' } };
    expect(addTagBodySchema.parse(body)).toEqual(body);
    expect(removeTagBodySchema.parse(body)).toEqual(body);
    expect(addTagBodySchema.safeParse({ meta: {} }).success).toBe(false);
    expect(addTagBodySchema.safeParse({}).success).toBe(false);
    expect(addTagBodySchema.safeParse({ meta: { tag: 'vip' } }).success).toBe(false);
  });

  it('replace the whole list', () => {
    const body = { meta: { 'tag-names': ['vip', 'gold'] } };
    expect(setTagsBodySchema.parse(body)).toEqual(body);
    expect(setTagsBodySchema.parse({ meta: { 'tag-names': [] } })).toEqual({
      meta: { 'tag-names': [] },
    });
    expect(setTagsBodySchema.safeParse({ meta: { 'tag-names': 'vip' } }).success).toBe(false);
  });
});
