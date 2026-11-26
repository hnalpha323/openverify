/**
 * Workflow 5A spec helpers (C63, C65.5): Phase 5 templates built from the registry defaults of
 * each type (`DEFAULT_<TYPE>_CHECKS`, C51.1), the sandbox SMS sink (C55.11) as a customer's test
 * harness reads it with a `sandbox:read` key, the inquiry a spec drives, and what the dashboard
 * shows of a Phase 5 verification's evidence. Every value a spec enters is synthetic.
 */
import {
  createInquiryTemplateAttributesSchema,
  defaultInquiryTemplateAttributes,
  type CreateInquiryTemplateAttributes,
  type DefaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import { expect, type Locator, type Page } from '@playwright/test';
import type { StackInfo } from '../../src/stack-info.js';
import { recordingClient } from './platform.js';

type FlowSteps = DefaultInquiryTemplateAttributes['flow']['steps'];
type VerificationConfig = CreateInquiryTemplateAttributes['verification-config'];
type TypeConfig = NonNullable<VerificationConfig[keyof VerificationConfig]>;
type CheckSwitch = TypeConfig['checks'][string];

/** A type's registry defaults (C51.1), as `@openverify/contracts` publishes them. */
export interface DefaultChecks {
  readonly required: readonly string[];
  readonly advisory: readonly string[];
  readonly disabled: readonly string[];
}

/** A type's configuration: its registry defaults, then `overrides` per check. */
export function typeConfig(
  defaults: DefaultChecks,
  overrides: Readonly<Record<string, CheckSwitch>> = {},
  options: Omit<TypeConfig, 'checks'> = {},
): TypeConfig {
  const checks: Record<string, CheckSwitch> = {};
  for (const id of defaults.required) {
    checks[id] = { enabled: true, required: true };
  }
  for (const id of defaults.advisory) {
    checks[id] = { enabled: true, required: false };
  }
  for (const id of defaults.disabled) {
    checks[id] = { enabled: false, required: false };
  }
  return { ...options, checks: { ...checks, ...overrides } };
}

const FAILED_INQUIRY = { '==': [{ var: 'inquiry.status' }, 'failed'] };

/**
 * A template of the default consent step, then `steps`, then the default completion and failure
 * steps; each step leads to the failure screen once the inquiry failed, as the default's do.
 */
export function phase5Template(
  name: string,
  steps: FlowSteps,
  config: VerificationConfig,
): DefaultInquiryTemplateAttributes {
  const defaults = defaultInquiryTemplateAttributes();
  const kept = (type: string) => defaults.flow.steps.filter((step) => step.type === type);
  // The required consent texts only: the optional matching consent is about selfies (C42.3).
  const consent = kept('consent').map((step) =>
    step.type === 'consent'
      ? { id: step.id, type: step.type, textKeys: step.textKeys, required: step.required }
      : step,
  );
  return createInquiryTemplateAttributesSchema.parse({
    name,
    flow: {
      metadata: { ...defaults.flow.metadata, id: 'phase5-e2e', version: 1, name },
      steps: [...consent, ...steps, ...kept('completion'), ...kept('failure')],
      transitions: steps.map((step) => ({
        from: step.id,
        to: 'failure',
        condition: FAILED_INQUIRY,
      })),
    },
    'verification-config': config,
  }) as DefaultInquiryTemplateAttributes;
}

/** A new inquiry on a new template, as a customer backend makes one, and its hosted-flow link. */
export async function startInquiry(
  stack: StackInfo,
  template: CreateInquiryTemplateAttributes,
  referenceId: string,
): Promise<{ inquiryId: string; flowUrl: string; sessionToken: string }> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: created } = await client.inquiryTemplates.create(template);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': created.id,
    'reference-id': referenceId,
  });
  const resumed = await client.inquiries.resume(inquiry.id);
  return {
    inquiryId: inquiry.id,
    flowUrl: resumed.meta['flow-url'],
    sessionToken: resumed.meta['session-token'],
  };
}

/**
 * C55.11: the codes the sandbox SMS sender kept for `phoneNumber`, newest first, read through
 * `@openverify/node` with the seeded key (it holds `sandbox:read`). The number goes in the body,
 * never in a URL.
 */
export async function sandboxSmsCodes(stack: StackInfo, phoneNumber: string): Promise<string[]> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data } = await client.sandboxSmsMessages.search(phoneNumber);
  return data.map((entry) => entry.code);
}

/** Waits for the sandbox sink to hold a code for `phoneNumber`, and returns the newest. */
export async function newestSandboxSmsCode(stack: StackInfo, phoneNumber: string): Promise<string> {
  let codes: string[] = [];
  await expect
    .poll(
      async () => {
        codes = await sandboxSmsCodes(stack, phoneNumber);
        return codes.length;
      },
      { timeout: 15_000, intervals: [250] },
    )
    .toBeGreaterThan(0);
  return codes[0] ?? '';
}

/** A code of the same length that is not `code`: its last digit moved by one. */
export function wrongCode(code: string): string {
  const last = Number(code.at(-1) ?? '0');
  return `${code.slice(0, -1)}${String((last + 1) % 10)}`;
}

/**
 * The value the dashboard shows for one attribute of a Phase 5 verification's evidence (the
 * generic evidence view, C54.5): the definition beside the term `term`.
 */
export function evidenceValue(page: Page, verificationLabel: string, term: string): Locator {
  return page
    .getByRole('group', { name: `${verificationLabel} evidence` })
    .locator('div')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${term}$`, 'u') }) })
    .locator('dd');
}

/** The flow API calls a Phase 5 step makes (C52), with the hosted flow's session token. */
export function phase5Flow(stack: StackInfo, sessionToken: string) {
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(`${stack.apiUrl}/api/v1/flow${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${sessionToken}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
  };
  const expectStatus = (
    answer: { status: number; body: unknown },
    status: number,
    what: string,
  ) => {
    if (answer.status !== status) {
      throw new Error(`${what} answered ${String(answer.status)}: ${JSON.stringify(answer.body)}`);
    }
    return answer.body;
  };
  return {
    /** `POST /verifications` for a Phase 5 API type; returns the verification id. */
    async create(type: string): Promise<string> {
      const body = expectStatus(await call('/verifications', { type }), 201, `create ${type}`);
      return (body as { data: { id: string } }).data.id;
    },
    /** C52.3: `POST /verifications/:id/inputs`. */
    async enterInputs(verificationId: string, values: Record<string, string>): Promise<void> {
      expectStatus(await call(`/verifications/${verificationId}/inputs`, values), 200, 'inputs');
    },
    /** `POST /verifications/:id/submit`. */
    async submit(verificationId: string): Promise<void> {
      expectStatus(await call(`/verifications/${verificationId}/submit`), 202, 'submit');
    },
  };
}
