/**
 * Workflow 4B review K202: the golden 409 problems in `contracts/fixtures/problems/`, one per C40
 * problem code (`SELFIE_CAPTURE_PROBLEM_CODES`), are what the flow API really answers, but for
 * `instance` and `requestId`, which name the request. The hosted flow and Android are tested
 * against these files, so a change of these bodies fails here first.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { expectStatus, PROBLEM_JSON } from '../../test-support/harness.js';
import {
  createCapture,
  postCapture,
  selfieFlow,
  submitCapture,
  templateWithSelfie,
  uploadPose,
} from './selfie.test-support.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

/** The golden problem `file`, or `undefined` while it does not exist. */
function golden(file: string): Record<string, unknown> | undefined {
  const url = new URL(`../../../../../contracts/fixtures/problems/${file}`, import.meta.url);
  return existsSync(url)
    ? (JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>)
    : undefined;
}

const VERIFICATION_PATH = /^\/api\/v1\/flow\/verifications\/ver_[0-9A-HJKMNP-TV-Z]{26}\//;

/** The answer equals the golden file, `instance` and `requestId` aside, and both name the route. */
function expectGolden(response: LightMyRequestResponse, file: string, route: string): void {
  expect(response.statusCode).toBe(409);
  expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  const body = response.json<Record<string, unknown>>();
  const fixture = golden(file);
  const named = { instance: '<instance>', requestId: '<request id>' };
  expect({ ...body, ...named }).toEqual(
    fixture === undefined ? undefined : { ...fixture, ...named },
  );
  const instance = new RegExp(`${VERIFICATION_PATH.source}${route}$`);
  expect(body.instance).toMatch(instance);
  expect(fixture?.instance).toMatch(instance);
  expect(body.requestId).toBe(response.headers['x-request-id']);
}

describe('the golden selfie capture problems (Workflow 4B review K202)', () => {
  it('selfie-capture-invalid.json: a pose uploaded with a wrong nonce', async () => {
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);

    const response = await uploadPose(api, flow, capture, 'center', { nonce: 'B'.repeat(22) });

    expectGolden(response, 'selfie-capture-invalid.json', 'files');
  });

  it('selfie-capture-required.json: a capture-bound selfie submitted without its capture', async () => {
    const flow = await selfieFlow(api);

    const response = await submitCapture(api, flow, null);

    expectGolden(response, 'selfie-capture-required.json', 'submit');
  });

  it('selfie-capture-incomplete.json: a submit before the side poses were uploaded', async () => {
    // Passive liveness prompts in the step's order, so the missing poses are always these two.
    const templateId = await templateWithSelfie(api, (step) => {
      step.liveness = 'passive';
      step.poses = ['center', 'left', 'right'];
    });
    const flow = await selfieFlow(api, { templateId });
    const capture = await createCapture(api, flow);
    expectStatus(await uploadPose(api, flow, capture, 'center'), 201);

    const response = await submitCapture(api, flow, capture);

    expectGolden(response, 'selfie-capture-incomplete.json', 'submit');
  });

  it('selfie-capture-limit.json: the create past the capture cap', async () => {
    const flow = await selfieFlow(api);
    for (let index = 0; index < 10; index += 1) {
      await createCapture(api, flow);
    }

    const response = await postCapture(api, flow);

    expectGolden(response, 'selfie-capture-limit.json', 'selfies');
  });
});
