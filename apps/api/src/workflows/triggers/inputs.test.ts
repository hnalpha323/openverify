/**
 * C118.2: a trigger's fields are validated by the live version's inputs. A file value is decoded,
 * typed by its magic bytes and in scope as its id, never as bytes; a malformed one answers 400, any
 * other field 422, and neither echoes a value (C143.5). Synthetic values.
 */
import type { WorkflowInput } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { AppError, WorkflowProblemError } from '../../errors.js';
import { ulidIdGenerator } from '../../ports.js';
import { inputsFit, readTriggerFields } from './inputs.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF = Buffer.from('%PDF-1.7\nsynthetic');

const input = (name: string, type: string, required = true): WorkflowInput => ({
  name,
  type,
  required,
});

const read = (declared: WorkflowInput[], fields: Record<string, unknown>) =>
  readTriggerFields(declared, fields, ulidIdGenerator);

function problemOf(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a problem');
}

const SECRET_VALUE = 'synthetic-value-canary';

describe('inputsFit (C118.3)', () => {
  it('reads values a step rendered against the inputs, with no file to take', () => {
    const declared = [input('amount', 'number'), input('note', 'string', false)];

    expect(inputsFit(declared, { amount: 1 })).toBe(true);
    expect(inputsFit(declared, { amount: 'one' })).toBe(false);
    expect(inputsFit(declared, {})).toBe(false);
    expect(inputsFit(declared, { amount: 1, other: true })).toBe(false);
  });

  it('never takes a file value, which only a request carries', () => {
    expect(
      inputsFit([input('document', 'file')], {
        document: { filename: 'a.png', data: PNG.toString('base64') },
      }),
    ).toBe(false);
  });
});

describe('readTriggerFields (C118.2)', () => {
  it('takes the declared fields as the run’s inputs', () => {
    const declared = [input('reference', 'string'), input('amount', 'number', false)];

    expect(read(declared, { reference: 'ref-1', amount: 2 })).toEqual({
      inputs: { reference: 'ref-1', amount: 2 },
      files: [],
    });
  });

  it('refuses a missing required field at its pointer', () => {
    const problem = problemOf(() => read([input('reference', 'string')], {}));

    expect(problem).toBeInstanceOf(WorkflowProblemError);
    expect(problem.code).toBe('trigger_input_invalid');
    expect(problem.members).toEqual({
      source: { pointer: '/data/attributes/fields/reference' },
    });
  });

  it('takes an optional field that is left out', () => {
    expect(read([input('note', 'string', false)], {}).inputs).toEqual({});
  });

  it('refuses a field no input declares, without echoing it (C143.5)', () => {
    const problem = problemOf(() => read([], { extra: SECRET_VALUE }));

    expect(problem.code).toBe('trigger_input_invalid');
    expect(problem.members).toEqual({ source: { pointer: '/data/attributes/fields/extra' } });
    expect(JSON.stringify([problem.message, problem.members])).not.toContain(SECRET_VALUE);
  });

  it('refuses a field of the wrong type at its pointer, without echoing it', () => {
    const problem = problemOf(() => read([input('amount', 'number')], { amount: SECRET_VALUE }));

    expect(problem.code).toBe('trigger_input_invalid');
    expect(problem.members).toEqual({ source: { pointer: '/data/attributes/fields/amount' } });
    expect(JSON.stringify([problem.message, problem.members])).not.toContain(SECRET_VALUE);
  });

  it('points inside a nested value', () => {
    const problem = problemOf(() =>
      read([input('person', 'object{age: number}')], { person: { age: 'old' } }),
    );

    expect(problem.members).toEqual({
      source: { pointer: '/data/attributes/fields/person/age' },
    });
  });

  it('puts a file in scope as its id, and keeps the bytes for storage', () => {
    const data = PNG.toString('base64');

    const { inputs, files } = read([input('document', 'file')], {
      document: { filename: 'synthetic.png', data },
    });

    expect(files).toHaveLength(1);
    expect(files[0]?.id).toMatch(/^wfrf_/);
    expect(inputs).toEqual({ document: files[0]?.id });
    expect(JSON.stringify(inputs)).not.toContain(data);
    expect(files[0]).toMatchObject({
      filename: 'synthetic.png',
      mimeType: 'image/png',
      bytes: PNG,
    });
    expect(files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('types a PDF by its magic bytes, not by its name', () => {
    const { files } = read([input('document', 'file')], {
      document: { filename: 'synthetic.png', data: PDF.toString('base64') },
    });

    expect(files[0]?.mimeType).toBe('application/pdf');
  });

  it('finds a file value inside a list and an object', () => {
    const value = { filename: 'synthetic.png', data: PNG.toString('base64') };

    const { inputs, files } = read(
      [input('pages', 'list<file>'), input('holder', 'object{scan: file}')],
      { pages: [value, value], holder: { scan: value } },
    );

    expect(files).toHaveLength(3);
    expect(inputs).toEqual({
      pages: [files[0]?.id, files[1]?.id],
      holder: { scan: files[2]?.id },
    });
  });

  it.each([
    ['a string', 'not a file value'],
    ['a member too many', { filename: 'a.png', data: PNG.toString('base64'), extra: 1 }],
    ['no filename', { data: PNG.toString('base64') }],
    ['data that is not base64', { filename: 'a.png', data: '***' }],
  ])('answers 400 with its pointer for %s', (_, value) => {
    const problem = problemOf(() => read([input('document', 'file')], { document: value }));

    expect(problem.status).toBe(400);
    expect(problem.members).toEqual({ source: { pointer: '/data/attributes/fields/document' } });
  });

  it('refuses a file past 10 MiB at its pointer', () => {
    const data = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]).toString('base64');

    const problem = problemOf(() =>
      read([input('document', 'file')], { document: { filename: 'large.png', data } }),
    );

    expect(problem.code).toBe('trigger_input_invalid');
    expect(problem.members).toEqual({ source: { pointer: '/data/attributes/fields/document' } });
  });

  it('refuses bytes it cannot type', () => {
    const problem = problemOf(() =>
      read([input('document', 'file')], {
        document: { filename: 'a.bin', data: Buffer.from('synthetic').toString('base64') },
      }),
    );

    expect(problem.code).toBe('trigger_input_invalid');
  });

  it('never takes a filename with control characters as written', () => {
    const { files } = read([input('document', 'file')], {
      document: { filename: 'synthetic\u0000.png', data: PNG.toString('base64') },
    });

    expect(files[0]?.filename).toBe('synthetic.png');
  });
});
