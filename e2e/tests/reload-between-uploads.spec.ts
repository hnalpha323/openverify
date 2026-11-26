/**
 * Review finding K001, and the C40 per-pose uploads. The hosted flow keeps its session across a
 * reload (sessionStorage), but not which images it already uploaded, nor the selfie capture's
 * nonce (memory only, C40.4).
 * - A reload between the front and the back upload makes it reuse the `initiated` verification
 *   and upload the front again. The API must take that upload (the new file replaces the earlier
 *   one), so the user can still finish.
 * - A reload after the first selfie pose was uploaded (each pose goes up before the next prompt,
 *   C40.3) makes it reuse the selfie verification and create a new capture, which supersedes the
 *   open one and deletes its files (C40.2); the user takes every pose again and finishes.
 *
 * The camera shows person A's still of the prompted pose until the next prompt (Workflow 5C
 * review K8), so the guidance's auto-capture takes the prompted pose on a loaded machine too.
 */
import { randomUUID } from 'node:crypto';
import { selfieVerificationResourceSchema } from '@openverify/contracts';
import { expect, test, type Request } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { giveConsent, selfieAnnouncement, takeSelfie, uploadId } from './support/flow.js';
import { recordingClient } from './support/platform.js';
import { usePromptedCamera } from './support/prompted-camera.js';
import { createServerApi } from './support/server-api.js';

const UPLOADS = '**/api/v1/flow/verifications/*/files';

const isUpload = (request: Request) =>
  request.method() === 'POST' &&
  /\/api\/v1\/flow\/verifications\/[^/]+\/files$/.test(request.url());

test('a reload between two uploads, of the ID or of the selfie poses, does not strand the user', async ({
  page,
}) => {
  const stack = readStackInfo();
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const inquiry = await api.createInquiry(stack.defaultTemplateId, `e2e-reload-${randomUUID()}`);
  const { flowUrl } = await api.resumeInquiry(inquiry.id);
  await usePromptedCamera(page, 'a');

  await page.goto(flowUrl);
  await giveConsent(page);

  // The front reaches the API; the connection drops before the back does.
  let uploads = 0;
  await page.route(UPLOADS, async (route) => {
    if (!isUpload(route.request())) {
      await route.continue();
      return;
    }
    uploads += 1;
    await (uploads === 2 ? route.abort('connectionreset') : route.continue());
  });
  await uploadId(page, FIXTURES.idFront, FIXTURES.idBack);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  expect(uploads).toBe(2);
  await page.unroute(UPLOADS);

  // After the reload the flow resumes the same verification and uploads both sides again.
  const answers: number[] = [];
  page.on('response', (response) => {
    if (isUpload(response.request())) {
      answers.push(response.status());
    }
  });
  await page.reload();
  await uploadId(page, FIXTURES.idFront, FIXTURES.idBack);

  // The selfie: the first pose is uploaded before the second prompt shows; then a reload.
  await expect(page.getByRole('heading', { level: 1, name: 'Take a selfie' })).toBeVisible({
    timeout: 90_000,
  });
  await page.getByRole('button', { name: 'Start the camera' }).click();
  await expect(selfieAnnouncement(page)).toHaveText(/Photo 2 of 3: /, { timeout: 45_000 });
  expect(answers).toEqual([201, 201, 201]);
  await page.reload();

  // A new capture, every pose again, each uploaded on its own (C40.3).
  const shots = await takeSelfie(page);
  expect(shots.map((shot) => shot.shutter)).toEqual(['auto', 'auto', 'auto']);
  await expect(page.getByRole('heading', { level: 1, name: 'Verification submitted' })).toBeVisible(
    { timeout: 90_000 },
  );
  expect(answers).toEqual([201, 201, 201, 201, 201, 201]);

  const document = await api.getInquiry(inquiry.id);
  expect(document.data.attributes.status).toBe('completed');
  expect(
    (document.included ?? []).map((verification) => [
      verification.type,
      verification.attributes.status,
      verification.relationships.files.data.length,
    ]),
  ).toEqual([
    ['verification/government-id', 'passed', 2],
    ['verification/selfie', 'passed', 3],
  ]);

  // The first capture was superseded by the second one, which the verification consumed.
  const selfie = selfieVerificationResourceSchema.parse(
    (document.included ?? []).find((verification) => verification.type === 'verification/selfie'),
  );
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const captures = await Promise.all(
    (selfie.relationships.selfies?.data ?? []).map(
      async ({ id }) => (await client.selfies.retrieve(id)).data.attributes,
    ),
  );
  expect(
    captures.map((capture) => [capture.status, capture['error-code'], capture.prompts.length]),
  ).toEqual([
    ['processed', null, 3],
    ['errored', 'superseded', 3],
  ]);
});
