import { AUDIT_ACTOR_TYPES, TRANSACTION_PROBLEM_CODES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  STATUS_CHANGE_ACTOR_WORDS,
  TRANSACTION_PROBLEM_WORDS,
  describeTransactionProblem,
} from './transaction-words';

describe('the transactions console in words (C108)', () => {
  it('says every transaction problem code as a sentence', () => {
    for (const code of TRANSACTION_PROBLEM_CODES) {
      expect(TRANSACTION_PROBLEM_WORDS[code], code).toMatch(/^[A-Z].*[.]$/u);
    }
    expect(TRANSACTION_PROBLEM_WORDS.card_number_refused).toBe(
      'A value looks like a payment card number, which is refused: send a processor’s token instead.',
    );
  });

  it('says who moved a status, for every actor type', () => {
    for (const type of AUDIT_ACTOR_TYPES) {
      expect(STATUS_CHANGE_ACTOR_WORDS[type], type).toMatch(/^[A-Z]/u);
    }
  });

  it('keeps the API’s words at a pointer for any code but the two limits (K7B-6)', () => {
    const problem = describeTransactionProblem({
      title: 'Unprocessable Entity',
      detail: 'A status is unknown.',
      status: 422,
      code: 'status_does_not_exist',
      errors: [{ pointer: '/data/attributes/status', detail: 'Not a status of this type.' }],
    });

    expect(problem.errors).toEqual([
      { pointer: '/data/attributes/status', detail: 'Not a status of this type.' },
    ]);
  });

  it('titles a refusal by its code, keeping the detail, status, request id and pointers', () => {
    const problem = describeTransactionProblem({
      title: 'Unprocessable Entity',
      detail: 'A field is invalid.',
      status: 422,
      requestId: 'req_1',
      code: 'field_schema_invalid',
      errors: [{ pointer: '/data/attributes/field-schemas/0/key', detail: 'Bad key.' }],
    });

    expect(problem).toEqual({
      title: TRANSACTION_PROBLEM_WORDS.field_schema_invalid,
      detail: 'A field is invalid.',
      status: 422,
      requestId: 'req_1',
      code: 'field_schema_invalid',
      errors: [{ pointer: '/data/attributes/field-schemas/0/key', detail: 'Bad key.' }],
    });
  });

  it('keeps a refusal with no code as the API worded it: its detail and pointer, no invented code', () => {
    const codeless = {
      title: 'Unprocessable Entity',
      detail: 'A cardinality-one relation already has a target.',
      status: 422,
      errors: [{ pointer: '/meta/target-object-id', detail: 'Already set.' }],
    };

    expect(describeTransactionProblem(codeless)).toBe(codeless);
  });
});
