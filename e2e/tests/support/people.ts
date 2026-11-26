/**
 * Workflow 5C `ui-people` helpers (C55, C56, C57, C66): the flow API calls a client makes for a
 * phone or email code and for a crypto wallet challenge, with the hosted flow's session token;
 * a verification awaited until the worker decided it; and what the console shows of a Phase 5
 * verification on its page: one term of its evidence, one check row, the folded checks. Every
 * value a spec sends is synthetic.
 */
import {
  flowCryptoChallengeResponseSchema,
  type FlowCryptoChallengeResponse,
  type FlowVerificationResource,
} from '@openverify/contracts';
import type { Locator, Page } from '@playwright/test';
import type { StackInfo } from '../../src/stack-info.js';
import { flowApi, giveFlowConsent, settledFlowVerification } from './platform.js';

interface FlowAnswer {
  readonly status: number;
  readonly body: unknown;
}

/** The flow API of the people steps, with one session token. */
export function peopleFlow(stack: StackInfo, sessionToken: string) {
  const post = async (path: string, body?: unknown): Promise<FlowAnswer> => {
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
  const expected = (answer: FlowAnswer, status: number, what: string): unknown => {
    if (answer.status !== status) {
      throw new Error(`${what} answered ${String(answer.status)}: ${JSON.stringify(answer.body)}`);
    }
    return answer.body;
  };
  return {
    /** Accepts the consent texts the session's consent step names. */
    consent(): Promise<void> {
      return giveFlowConsent(flowApi(stack.apiUrl, sessionToken));
    },
    /** `POST /verifications` for a Phase 5 API type; returns the verification id. */
    async create(type: 'phone-number' | 'email-address' | 'crypto-wallet'): Promise<string> {
      const body = expected(await post('/verifications', { type }), 201, `create ${type}`);
      return (body as { data: { id: string } }).data.id;
    },
    /** C55.6: `POST /verifications/:id/otp`, which sends one code. */
    async sendCode(
      verificationId: string,
      destination: { 'phone-number': string } | { 'email-address': string },
    ): Promise<void> {
      expected(await post(`/verifications/${verificationId}/otp`, destination), 200, 'send a code');
    },
    /** C55.5: `POST /verifications/:id/otp/confirm`; returns the status (200, or 422 when wrong). */
    async confirmCode(verificationId: string, code: string): Promise<number> {
      return (await post(`/verifications/${verificationId}/otp/confirm`, { code })).status;
    },
    /** C57.2: `POST /verifications/:id/crypto-challenges`, the message the server issues. */
    async cryptoChallenge(
      verificationId: string,
      chainId: string,
      walletAddress: string,
    ): Promise<FlowCryptoChallengeResponse> {
      return flowCryptoChallengeResponseSchema.parse(
        expected(
          await post(`/verifications/${verificationId}/crypto-challenges`, {
            'chain-id': chainId,
            'wallet-address': walletAddress,
          }),
          201,
          'crypto challenge',
        ),
      );
    },
    /** `POST /verifications/:id/submit`, with the type's body when it takes one. */
    async submit(verificationId: string, body?: unknown): Promise<void> {
      expected(await post(`/verifications/${verificationId}/submit`, body), 202, 'submit');
    },
    /** Waits until the worker decided the verification; its flow view. */
    decided(verificationId: string): Promise<FlowVerificationResource> {
      return settledFlowVerification(flowApi(stack.apiUrl, sessionToken), verificationId);
    },
  };
}

/** The value (`<dd>`) of the term `term` of a Phase 5 verification's evidence. */
export function evidenceTerm(page: Page, verificationLabel: string, term: string): Locator {
  return page
    .getByRole('group', { name: `${verificationLabel} evidence` })
    .locator(`dt:text-is("${term}") + dd`);
}

/** One check's row on the verification page, in whichever of its tables it is listed. */
export function checkRowOnPage(page: Page, checkName: string): Locator {
  return page
    .getByRole('region', { name: 'Checks', exact: true })
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: checkName, exact: true }) });
}

/** Opens the checks the page folds away ("All checks: …" or "Other checks: …", C37). */
export async function openFoldedChecks(page: Page): Promise<void> {
  await page
    .getByRole('region', { name: 'Checks', exact: true })
    .locator('summary')
    .filter({ hasText: /^(All|Other) checks:/u })
    .click();
}
