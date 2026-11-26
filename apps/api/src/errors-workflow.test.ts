/**
 * C112.8, C113.6 (Workflow 8A): the API's error for `WORKFLOW_PROBLEM_STATUSES`. The status comes from
 * the contract's table, a definition's errors carry their pointer and code, and the three extension
 * members amendment 18 names reach the problem document.
 */
import {
  WORKFLOW_PROBLEM_CODES,
  WORKFLOW_PROBLEM_STATUSES,
  problemSchema,
} from '@openverify/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { WorkflowProblemError } from './errors.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function problemOf(error: Error) {
  const app = buildApp({ lookupApiKey: () => Promise.resolve(null), logger: false });
  apps.push(app);
  app.get('/boom', { config: { public: true } }, () => {
    throw error;
  });
  const response = await app.inject({ method: 'GET', url: '/boom' });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

describe('WorkflowProblemError', () => {
  it.each(WORKFLOW_PROBLEM_CODES)('answers %s with its status and code', async (code) => {
    const { status, body } = await problemOf(new WorkflowProblemError(code, 'Synthetic detail.'));

    expect(status).toBe(WORKFLOW_PROBLEM_STATUSES[code]);
    expect(body.code).toBe(code);
    expect(problemSchema.safeParse(body).success).toBe(true);
  });

  it('calls 422 Unprocessable Content', async () => {
    const { body } = await problemOf(
      new WorkflowProblemError('definition_invalid', 'Synthetic detail.'),
    );

    expect(body.title).toBe('Unprocessable Content');
  });

  it('carries a definition’s errors with their pointers and codes (C113.6)', async () => {
    const { body } = await problemOf(
      new WorkflowProblemError('definition_invalid', 'Synthetic detail.', {
        errors: [
          {
            location: 'definition',
            pointer: '/steps/3/config/url',
            code: 'pii_in_url',
            detail: 'A personal value cannot go in a URL.',
          },
        ],
      }),
    );

    expect(body.errors).toEqual([
      {
        location: 'definition',
        pointer: '/steps/3/config/url',
        code: 'pii_in_url',
        detail: 'A personal value cannot go in a URL.',
      },
    ]);
    expect(problemSchema.safeParse(body).success).toBe(true);
  });

  it('names the missing scopes of a publish (C116.4)', async () => {
    const { body } = await problemOf(
      new WorkflowProblemError('publish_grant_missing', 'Synthetic detail.', {
        members: { 'missing-scopes': ['inquiries:write'] },
      }),
    );

    expect(body['missing-scopes']).toEqual(['inquiries:write']);
  });

  it('names what blocks a resume (C120.3)', async () => {
    const { body } = await problemOf(
      new WorkflowProblemError('run_not_resumable', 'Synthetic detail.', {
        members: { 'blocked-by': 'unknown_effect', 'step-id': 'send_email' },
      }),
    );

    expect(body).toMatchObject({ 'blocked-by': 'unknown_effect', 'step-id': 'send_email' });
  });

  it('points at the input a trigger refused, never at its value (C118.2)', async () => {
    const { body } = await problemOf(
      new WorkflowProblemError('trigger_input_invalid', 'Synthetic detail.', {
        members: { source: { pointer: '/data/attributes/fields/name' } },
      }),
    );

    expect(body.source).toEqual({ pointer: '/data/attributes/fields/name' });
  });
});
