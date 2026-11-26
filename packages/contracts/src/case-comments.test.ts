import { describe, expect, it } from 'vitest';
import {
  PII_CASE_COMMENT_ATTRIBUTES,
  buildCaseCommentResource,
  caseCommentAttributesSchema,
  caseCommentDocumentSchema,
  caseCommentListDocumentSchema,
  listCaseCommentsQuerySchema,
  redactCaseCommentBodySchema,
} from './case-comments.js';
import { readFixture } from './test-support.js';

const CASE = 'case_01M5CN00000000000000000001';
const COMMENT = 'cscm_01M5CN00000000000000000008';
const USER = 'usr_01M5CN00000000000000000010';
const REVIEWER = 'usr_01M5CN00000000000000000011';
const AT = new Date('2026-10-20T12:05:00.000Z');

describe('case comments (C134)', () => {
  it('builds the golden comment', () => {
    const golden = caseCommentDocumentSchema.parse(readFixture('api/case-comment.json'));
    expect(
      buildCaseCommentResource({
        id: COMMENT,
        caseId: CASE,
        message: golden.data.attributes.message,
        commenterType: 'user',
        commenterId: USER,
        mentions: [REVIEWER],
        createdAt: AT,
        updatedAt: AT,
        redactedAt: null,
      }),
    ).toEqual(golden.data);
  });

  it('keeps ids, the author and the times once a message is redacted (C134.2)', () => {
    const redacted = buildCaseCommentResource({
      id: COMMENT,
      caseId: CASE,
      message: null,
      commenterType: 'workflow-run',
      commenterId: 'wfr_01M5CM00000000000000000003',
      mentions: [],
      createdAt: AT,
      updatedAt: AT,
      redactedAt: AT,
    });
    expect(redacted.attributes.message).toBeNull();
    expect(redacted.attributes['commenter-id']).toBe('wfr_01M5CM00000000000000000003');
    expect(redacted.id).toBe(COMMENT);
  });

  it('lists the message for the masks (C143.5)', () => {
    expect(PII_CASE_COMMENT_ATTRIBUTES).toEqual(['message']);
  });

  it('refuses an id that is not its commenter type (decision 64)', () => {
    const attributes = {
      message: null,
      'created-at': '2026-10-20T12:05:00.000Z',
      'updated-at': '2026-10-20T12:05:00.000Z',
      'redacted-at': null,
      mentions: [],
    };
    expect(
      caseCommentAttributesSchema.safeParse({
        ...attributes,
        'commenter-type': 'user',
        'commenter-id': USER,
      }).success,
    ).toBe(true);
    for (const id of [
      'wfr_01M5CM00000000000000000003',
      'reviewee@example.com',
      'key_01M5CN00000000000000000010',
    ]) {
      expect(
        caseCommentAttributesSchema.safeParse({
          ...attributes,
          'commenter-type': 'user',
          'commenter-id': id,
        }).success,
      ).toBe(false);
    }
  });

  it('caps a message at 10,000 characters on the resource', () => {
    const attributes = {
      'created-at': '2026-10-20T12:05:00.000Z',
      'updated-at': '2026-10-20T12:05:00.000Z',
      'redacted-at': null,
      'commenter-type': 'user',
      'commenter-id': USER,
      mentions: [],
    };
    expect(
      caseCommentAttributesSchema.safeParse({ ...attributes, message: 'x'.repeat(10_000) }).success,
    ).toBe(true);
    expect(
      caseCommentAttributesSchema.safeParse({ ...attributes, message: 'x'.repeat(10_001) }).success,
    ).toBe(false);
  });

  it('lists comments by cursor, and a redaction takes no parameters', () => {
    expect(listCaseCommentsQuerySchema.safeParse({ 'page[after]': COMMENT }).success).toBe(true);
    expect(listCaseCommentsQuerySchema.safeParse({ 'page[after]': CASE }).success).toBe(false);
    expect(redactCaseCommentBodySchema.safeParse(undefined).success).toBe(true);
    expect(redactCaseCommentBodySchema.safeParse({ meta: { message: 'x' } }).success).toBe(false);
    expect(
      caseCommentListDocumentSchema.safeParse({ data: [], links: { next: null } }).success,
    ).toBe(true);
  });
});
