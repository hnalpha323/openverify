import { LIST_PROBLEM_CODES } from '@openverify/contracts';
import {
  IMPORTER_MODES,
  IMPORTER_STATUSES,
  IMPORT_ERROR_CODES,
  LIST_ITEM_STATUSES,
  LIST_KINDS,
  LIST_STATUSES,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  IMPORTER_MODE_LABELS,
  IMPORTER_STATUS_LABELS,
  IMPORT_ERROR_WORDS,
  LIST_ITEM_STATUS_LABELS,
  LIST_KIND_LABELS,
  LIST_PROBLEM_WORDS,
  LIST_STATUS_LABELS,
  describeListProblem,
  kindOfListType,
} from './list-words';

const sentence = /^[A-Z].*[.]$/u;

describe('the lists console in words (C108)', () => {
  it('names every list kind, status, item status, importer status and mode', () => {
    for (const kind of LIST_KINDS) {
      expect(LIST_KIND_LABELS[kind], kind).toMatch(/^[A-Z]/u);
    }
    expect(new Set(Object.values(LIST_KIND_LABELS)).size).toBe(LIST_KINDS.length);
    for (const status of LIST_STATUSES) {
      expect(LIST_STATUS_LABELS[status], status).toMatch(/^[A-Z]/u);
    }
    for (const status of LIST_ITEM_STATUSES) {
      expect(LIST_ITEM_STATUS_LABELS[status], status).toMatch(/^[A-Z]/u);
    }
    for (const status of IMPORTER_STATUSES) {
      expect(IMPORTER_STATUS_LABELS[status], status).toMatch(/^[A-Z]/u);
    }
    for (const mode of IMPORTER_MODES) {
      expect(IMPORTER_MODE_LABELS[mode], mode).toMatch(/^[A-Z]/u);
    }
  });

  it('says a pending item is not matched yet, never that it matched nothing', () => {
    expect(LIST_ITEM_STATUS_LABELS.pending).toBe('Pending (not matched yet)');
  });

  it('says every importer error code as a sentence, never with a value (C100.4)', () => {
    for (const code of IMPORT_ERROR_CODES) {
      expect(IMPORT_ERROR_WORDS[code], code).toMatch(sentence);
    }
    expect(IMPORT_ERROR_WORDS.host_bits_set).toBe(
      'The range has host bits set: give the network address of the range.',
    );
  });

  it('says every list problem code as a sentence', () => {
    for (const code of LIST_PROBLEM_CODES) {
      expect(LIST_PROBLEM_WORDS[code], code).toMatch(sentence);
    }
    expect(LIST_PROBLEM_WORDS.retention_exceeds_consent).toBe(
      'Face and background items cannot be kept longer than the face template retention of this environment, which the source consent promises.',
    );
  });

  it('titles a refusal by its list code, keeping the detail, status, request id and pointers', () => {
    const problem = describeListProblem({
      title: 'Conflict',
      detail: 'Set biometric-lists-basis first.',
      status: 409,
      requestId: 'req_1',
      code: 'biometric_lists_not_acknowledged',
      errors: [{ pointer: '/data/attributes/name', detail: 'Too long' }],
    });

    expect(problem).toEqual({
      title: LIST_PROBLEM_WORDS.biometric_lists_not_acknowledged,
      detail: 'Set biometric-lists-basis first.',
      status: 409,
      requestId: 'req_1',
      code: 'biometric_lists_not_acknowledged',
      errors: [{ pointer: '/data/attributes/name', detail: 'Too long' }],
    });
    const other = { title: 'Conflict', code: 'something_else' };
    expect(describeListProblem(other)).toBe(other);
  });

  it('reads the kind of a list, item or importer resource type', () => {
    expect(kindOfListType('list/email-address')).toBe('email-address');
    expect(kindOfListType('list-item/government-id-number')).toBe('government-id-number');
    expect(kindOfListType('importer/list-item/ip-address')).toBe('ip-address');
  });
});
