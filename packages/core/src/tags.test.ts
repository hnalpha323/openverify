import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import {
  InvalidTagError,
  MAX_TAGS_PER_OBJECT,
  MAX_TAG_LENGTH,
  TooManyTagsError,
  addTag,
  dedupeTags,
  hasTag,
  isValidTag,
  normalizeTag,
  normalizeTags,
  removeTag,
  tagKey,
  validateTag,
} from './tags.js';

const tags = (count: number) => Array.from({ length: count }, (_, index) => `tag-${String(index)}`);

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('tag limits (C9)', () => {
  it('allows 64 characters per tag and 50 tags per object', () => {
    expect(MAX_TAG_LENGTH).toBe(64);
    expect(MAX_TAGS_PER_OBJECT).toBe(50);
  });
});

describe('normalizeTag', () => {
  it('trims surrounding spaces and composes Unicode (NFC)', () => {
    expect(normalizeTag('  vip  ')).toBe('vip');
    expect(normalizeTag('Revisión')).toBe('Revisión');
  });

  it('keeps case and inner spaces', () => {
    expect(normalizeTag('High Risk')).toBe('High Risk');
  });
});

describe('isValidTag', () => {
  it.each([
    'vip',
    'High Risk',
    'Revisión',
    'हिंदी',
    '日本',
    'tier:gold',
    'region/eu-west',
    'batch_2026.10',
    '42',
    '  padded  ',
    'x'.repeat(64),
    '日'.repeat(64),
    '𝒜'.repeat(64),
  ])('accepts %j', (tag) => {
    expect(isValidTag(tag)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['65 characters', 'x'.repeat(65)],
    ['a comma, which separates filter values', 'a,b'],
    ['a hash', '#vip'],
    ['an emoji', 'vip🔥'],
    ['a tab', 'a\tb'],
    ['a newline', 'a\nb'],
    ['a quote', '"vip"'],
  ])('rejects %s', (_name, tag) => {
    expect(isValidTag(tag)).toBe(false);
  });
});

describe('validateTag', () => {
  it('returns the normalized tag', () => {
    expect(validateTag(' Watchlist ')).toBe('Watchlist');
  });

  it('throws a typed domain error without echoing the tag', () => {
    const error = thrownBy(() => validateTag('bad#tag'));
    expect(error).toBeInstanceOf(InvalidTagError);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'invalid_tag', name: 'InvalidTagError' });
    expect((error as Error).message).not.toContain('bad#tag');
  });
});

describe('tagKey and hasTag', () => {
  it('compare tags ignoring case', () => {
    expect(tagKey('VIP')).toBe(tagKey('vip'));
    expect(tagKey(' Vip ')).toBe(tagKey('vIP'));
    expect(tagKey('Straße')).toBe(tagKey('STRASSE'));
    expect(tagKey('vip')).not.toBe(tagKey('vips'));
    expect(hasTag(['Gold', 'VIP'], 'vip')).toBe(true);
    expect(hasTag(['Gold'], 'silver')).toBe(false);
  });
});

describe('dedupeTags', () => {
  it('keeps the first spelling of each tag, in order', () => {
    expect(dedupeTags(['VIP', 'gold', 'vip', ' Gold ', 'silver'])).toEqual([
      'VIP',
      'gold',
      'silver',
    ]);
  });
});

describe('normalizeTags (set-tags)', () => {
  it('validates, normalizes and dedupes the whole list', () => {
    expect(normalizeTags([' vip', 'VIP', 'tier:gold'])).toEqual(['vip', 'tier:gold']);
    expect(normalizeTags([])).toEqual([]);
  });

  it('rejects the list when any tag is invalid', () => {
    expect(() => normalizeTags(['ok', 'not ok!'])).toThrow(InvalidTagError);
  });

  it('allows 50 distinct tags, counting duplicates once', () => {
    expect(normalizeTags(tags(MAX_TAGS_PER_OBJECT))).toHaveLength(50);
    expect(normalizeTags([...tags(50), 'TAG-0'])).toHaveLength(50);
  });

  it('rejects more than 50 distinct tags with a typed error', () => {
    const error = thrownBy(() => normalizeTags(tags(51)));
    expect(error).toBeInstanceOf(TooManyTagsError);
    expect(error).toMatchObject({ code: 'too_many_tags', limit: 50 });
  });
});

describe('addTag', () => {
  it('appends a new tag in its normalized form', () => {
    expect(addTag(['vip'], ' gold ')).toEqual(['vip', 'gold']);
  });

  it('is a no-op for a tag already present in another case', () => {
    const current = ['VIP'];
    const result = addTag(current, 'vip');
    expect(result).toEqual(['VIP']);
    expect(result).not.toBe(current);
  });

  it('rejects an invalid tag', () => {
    expect(() => addTag([], '')).toThrow(InvalidTagError);
  });

  it('refuses a 51st tag but accepts a duplicate of an existing one', () => {
    const full = tags(MAX_TAGS_PER_OBJECT);
    expect(() => addTag(full, 'one-more')).toThrow(TooManyTagsError);
    expect(addTag(full, 'TAG-1')).toEqual(full);
  });
});

describe('removeTag', () => {
  it('removes a tag ignoring case', () => {
    expect(removeTag(['VIP', 'gold'], ' vip ')).toEqual(['gold']);
  });

  it('is a no-op for a tag that is absent or could never be stored', () => {
    expect(removeTag(['gold'], 'silver')).toEqual(['gold']);
    expect(removeTag(['gold'], '###')).toEqual(['gold']);
  });
});
