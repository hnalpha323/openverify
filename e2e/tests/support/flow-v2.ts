/**
 * C178.4 (Workflow 9A, integration-9a): helpers of the 9A specs. A flow-spec 2 version is drafted
 * through the server API, validated in publish mode to learn the acknowledgements it needs, and
 * published by a user (only a person gives an acknowledgement, C154.9); the flow API is driven as
 * a spec-2 client; and the step record, which no route serves (C151.1), is read from the database.
 * Every value is synthetic.
 */
import {
  defaultInquiryTemplateAttributes,
  FLOW_SPEC_HEADER,
  PLAY_INTEGRITY_NOTICE_TEXT_KEY,
  type FlowSessionResponse,
} from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import { expect } from '@playwright/test';
import pg from 'pg';
import type { StackInfo } from '../../src/stack-info.js';
import { recordingClient } from './platform.js';
import { adminClient } from './workflows.js';

/**
 * The default template's consent step, required texts only (C42.3), as the flow's first step, with
 * `notice.play-integrity` beside its session-integrity notice: the stack binds the sandbox
 * `deviceIntegrity` provider, so publish requires it (C211.9, decision 66; Workflow 10B).
 */
export function consentStep(): Record<string, unknown> {
  const consent = defaultInquiryTemplateAttributes().flow.steps.find(
    (step) => step.type === 'consent',
  );
  if (consent?.type !== 'consent') {
    throw new Error('The default template has no consent step');
  }
  return {
    id: 'consent',
    type: 'consent',
    textKeys: [...consent.textKeys, PLAY_INTEGRITY_NOTICE_TEXT_KEY],
    required: true,
  };
}

/** The text keys the consent step above records. */
export function consentKeys(): readonly string[] {
  return (consentStep() as { textKeys: string[] }).textKeys;
}

export interface PublishedV2 {
  templateId: string;
  versionId: string;
  /** What `validate` in publish mode asked for, and the publish recorded. */
  acknowledgements: readonly string[];
}

interface JsonAnswer {
  status: number;
  body: unknown;
}

async function send(
  url: string,
  token: string,
  method: 'GET' | 'POST',
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<JsonAnswer> {
  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
}

function expectStatus(answer: JsonAnswer, status: number, what: string): unknown {
  if (answer.status !== status) {
    throw new Error(`${what} answered ${String(answer.status)}: ${JSON.stringify(answer.body)}`);
  }
  return answer.body;
}

/**
 * A template whose published version holds `flow` (flow-spec 2) and `members`: the template is made
 * with the default v1 flow (`POST /inquiry-templates` takes v1 only, amendment 27), then a v2 draft,
 * validated in publish mode and published by the seeded admin with every acknowledgement it needs.
 */
export async function publishV2(
  stack: StackInfo,
  admin: OpenVerifyClient,
  name: string,
  flow: unknown,
  members: Record<string, unknown>,
): Promise<PublishedV2> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: template } = await client.inquiryTemplates.create({
    ...defaultInquiryTemplateAttributes(),
    name,
  });
  const { data: draft } = await client.inquiryTemplateVersions
    .create({ 'inquiry-template-id': template.id, flow, ...members } as never)
    .catch((error: unknown) => {
      // The refused rules, each at its pointer (C154.2), never a value: say which.
      const problem = (error as { problem?: unknown }).problem;
      throw new Error(`the draft was refused: ${JSON.stringify(problem ?? String(error))}`);
    });
  const validation = expectStatus(
    await send(
      `${stack.apiUrl}/api/v1/inquiry-template-versions/${draft.id}/validate`,
      stack.apiKey,
      'POST',
      { meta: { mode: 'publish' } },
    ),
    200,
    'validate',
  ) as {
    data: {
      attributes: {
        validation: { status: string; problems: { code: string; severity: string }[] };
        'acknowledgements-required': string[];
      };
    };
  };
  const errors = validation.data.attributes.validation.problems.filter(
    (problem) => problem.severity === 'error',
  );
  expect(errors, JSON.stringify(errors)).toEqual([]);
  const acknowledgements = validation.data.attributes['acknowledgements-required'];
  await admin.inquiryTemplateVersions.publish(draft.id, {
    acknowledgements: [...acknowledgements],
    'publish-note': 'Synthetic e2e version.',
  });
  return { templateId: template.id, versionId: draft.id, acknowledgements };
}

/** The admin's client, signed in once per spec file (a sign-in counts against the login limits). */
export async function signedInAdmin(stack: StackInfo): Promise<OpenVerifyClient> {
  return adminClient(stack);
}

/** A new inquiry of `templateId` and its session, as a customer backend makes them. */
export async function startV2Inquiry(
  stack: StackInfo,
  templateId: string,
  referenceId: string,
  fields: Readonly<Record<string, string>> = {},
): Promise<{ inquiryId: string; sessionToken: string; flowUrl: string }> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': templateId,
    'reference-id': referenceId,
    fields,
  });
  const resumed = await client.inquiries.resume(inquiry.id);
  return {
    inquiryId: inquiry.id,
    sessionToken: resumed.meta['session-token'],
    flowUrl: resumed.meta['flow-url'],
  };
}

/** The flow API as a client that renders flow-spec 2 (`OpenVerify-Flow-Spec: 1, 2`, C151.7). */
export function v2Flow(stack: StackInfo, sessionToken: string) {
  const url = (path: string) => `${stack.apiUrl}/api/v1/flow${path}`;
  const spec = { [FLOW_SPEC_HEADER]: '1, 2' };
  return {
    async session(): Promise<FlowSessionResponse> {
      return expectStatus(
        await send(url('/session'), sessionToken, 'GET', undefined, spec),
        200,
        'session',
      ) as FlowSessionResponse;
    },
    async consent(): Promise<void> {
      expectStatus(
        await send(url('/consent'), sessionToken, 'POST', {
          accepted: true,
          'text-keys': consentKeys(),
          locale: 'en',
        }),
        201,
        'consent',
      );
    },
    /** A screen's submission; the answer is the session at the next position (C148.5). */
    async submitScreen(
      stepId: string,
      values: Readonly<Record<string, unknown>> = {},
    ): Promise<FlowSessionResponse> {
      return expectStatus(
        await send(url(`/screens/${stepId}/submit`), sessionToken, 'POST', { values }, spec),
        200,
        `submit ${stepId}`,
      ) as FlowSessionResponse;
    },
    /** One collector payload of the web flow on `screen`, with a sandbox outcome (C90.9). */
    async signals(screen: string, outcome: 'bot' | 'human'): Promise<void> {
      const answer = await send(url('/signals'), sessionToken, 'POST', {
        platform: 'web',
        'collector-version': 1,
        screen,
        sequence: 0,
        'sandbox-outcome': outcome,
      });
      expect([200, 201, 202], JSON.stringify(answer.body)).toContain(answer.status);
    },
  };
}

/** Polls the session (which also ends a wait the poll finds over, C150.5) until `done` holds. */
export async function pollSession(
  flow: ReturnType<typeof v2Flow>,
  done: (session: FlowSessionResponse) => boolean,
  timeoutMs = 60_000,
): Promise<FlowSessionResponse> {
  let last: FlowSessionResponse | undefined;
  await expect
    .poll(
      async () => {
        last = await flow.session();
        return done(last);
      },
      { timeout: timeoutMs, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);
  if (last === undefined) {
    throw new Error('no session read');
  }
  return last;
}

/** Waits until the inquiry's status is one of `statuses`, and answers its attributes. */
export async function settledInquiry(
  stack: StackInfo,
  inquiryId: string,
  statuses: readonly string[],
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  await expect
    .poll(
      async () =>
        statuses.includes((await client.inquiries.retrieve(inquiryId)).data.attributes.status),
      { timeout: timeoutMs, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);
  return (await client.inquiries.retrieve(inquiryId)).data.attributes;
}

export interface StepRecordEntry {
  stepId: string;
  stepType: string;
  exitPort: string | null;
  outcome: string | null;
  notes: string[];
}

/** The inquiry's step record (C151.1), in order. No route serves it, so it is read from Postgres. */
export async function stepRecord(stack: StackInfo, inquiryId: string): Promise<StepRecordEntry[]> {
  const client = new pg.Client({ connectionString: stack.databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{
      step_id: string;
      step_type: string;
      exit_port: string | null;
      outcome: string | null;
      notes: string[] | null;
    }>(
      `select step_id, step_type, exit_port, outcome, notes
         from inquiry_flow_steps where inquiry_id = $1 order by seq`,
      [inquiryId],
    );
    return rows.map((row) => ({
      stepId: row.step_id,
      stepType: row.step_type,
      exitPort: row.exit_port,
      outcome: row.outcome,
      notes: row.notes ?? [],
    }));
  } finally {
    await client.end();
  }
}

/** `[step id, exit port]` of each entry, the path in brief. */
export const pathOf = (record: readonly StepRecordEntry[]): [string, string | null][] =>
  record.map((entry) => [entry.stepId, entry.exitPort]);
