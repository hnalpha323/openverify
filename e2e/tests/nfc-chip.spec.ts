/**
 * C62, C65.5 (Workflow 5B): a government ID chip verified on the server, full stack. The e2e acts
 * as the Phase 10 reader would: it builds the chip with `@openverify/emrtd/testing` under the
 * Utopia test CSCA that `seed:dev` put in the trust store (with its CRL), signs the documents with
 * a DSC of this run, and sends the files and the Active Authentication answer to the server's own
 * nonce through the flow API. The chip holds the TD3 page's MRZ (DG1) and person A's portrait as
 * JPEG 2000 (DG2) (C65.3).
 * - An inquiry with the TD3 page as a one-sided ID, person A's selfie (the sandbox upload
 *   fallback) and the chip: every required NFC check passes.
 * - The same chip files replayed into an inquiry of another account with person B's selfie: the
 *   chip portrait does not match the presenter (`face_mismatch`), and the advisory repeat check
 *   records the first read as one sighting.
 * A tampered DG1 (`dg_hash_mismatch`) is tested against Postgres only (V05). Every value is
 * synthetic: the issuer is Utopia, no key file exists, and nothing comes from a real chip.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_GOVERNMENT_ID_NFC_CHECKS,
  defaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import {
  buildUtopiaChip,
  signActiveAuthentication,
  type UtopiaChip,
} from '@openverify/emrtd/testing';
import { expect, test } from '@playwright/test';
import { NFC_FIXTURES, selfieStill } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { phase5Template, startInquiry, typeConfig } from './support/phase5.js';
import { phase5bFlow } from './support/phase5b.js';
import {
  flowApi,
  giveFlowConsent,
  recordingClient,
  settledFlowVerification,
} from './support/platform.js';

/** The chip files by upload kind (C52.4), as a reader sends them. */
function chipUploads(chip: UtopiaChip): [string, Uint8Array][] {
  const { files } = chip;
  const groups = [1, 2, 14, 15] as const;
  return [
    ['chip-sod', files.sod],
    ...groups.flatMap((group): [string, Uint8Array][] => {
      const bytes = files.dataGroups[group];
      return bytes === undefined ? [] : [[`chip-dg${String(group)}`, bytes]];
    }),
    ...(files.com === undefined ? [] : ([['chip-com', files.com]] as [string, Uint8Array][])),
  ];
}

/**
 * The chip steps after consent: a one-sided ID (the TD3 page) when `withId`, the default selfie,
 * and the NFC step (C50.4: after the selfie and the ID). Without an ID step, the selfie is judged
 * without its ID comparison.
 */
function chipTemplate(name: string, withId: boolean) {
  const defaults = defaultInquiryTemplateAttributes();
  const governmentId = defaults.flow.steps.find((step) => step.type === 'government_id');
  const selfie = defaults.flow.steps.find((step) => step.type === 'selfie');
  const governmentIdConfig = defaults['verification-config']['government-id'];
  const selfieConfig = defaults['verification-config'].selfie;
  if (
    governmentId === undefined ||
    selfie === undefined ||
    governmentIdConfig === undefined ||
    selfieConfig === undefined
  ) {
    throw new Error('The default template has no government ID or selfie step');
  }
  return phase5Template(
    name,
    [
      ...(withId ? [{ ...governmentId, sides: 'front' as const }] : []),
      selfie,
      { id: 'nfc', type: 'nfc', androidOnly: true },
    ],
    {
      ...(withId ? { 'government-id': governmentIdConfig } : {}),
      selfie: withId
        ? selfieConfig
        : {
            ...selfieConfig,
            checks: {
              ...selfieConfig.checks,
              selfie_id_comparison: { enabled: false, required: false },
            },
          },
      'government-id-nfc': typeConfig(DEFAULT_GOVERNMENT_ID_NFC_CHECKS),
    },
  );
}

/** Uploads the chip, takes the server's nonce, answers it with the chip's AA key, and submits. */
async function submitChip(sessionToken: string, chip: UtopiaChip): Promise<string> {
  const stack = readStackInfo();
  const phase5b = phase5bFlow(stack, sessionToken);
  const verificationId = await phase5b.create('government-id-nfc');
  for (const [kind, bytes] of chipUploads(chip)) {
    await phase5b.upload(verificationId, kind, bytes);
  }
  const challenge = await phase5b.chipChallenge(verificationId);
  const key = chip.activeAuthenticationKey;
  if (key === null) {
    throw new Error('The Utopia chip has no Active Authentication key');
  }
  const response = signActiveAuthentication(key, Buffer.from(challenge.nonce, 'hex'));
  await phase5b.submit(verificationId, {
    chip: {
      'challenge-id': challenge.id,
      nonce: challenge.nonce,
      'active-authentication-response': Buffer.from(response).toString('base64'),
      'device-report': {
        protocols: [
          { protocol: 'pace', outcome: 'succeeded' },
          { protocol: 'active-authentication', outcome: 'succeeded' },
        ],
        'read-ms': 2_100,
      },
    },
  });
  return verificationId;
}

async function checksOf(verificationId: string) {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data } = await client.verifications.retrieve(verificationId);
  return {
    status: data.attributes.status,
    checks: Object.fromEntries(data.attributes.checks.map((check) => [check.name, check])),
    attributes: data.attributes as Record<string, unknown>,
  };
}

test('a Utopia chip read with its holder’s selfie passes every required check, and its replay with another face fails face_mismatch and is a sighting (C62.6, C65.5)', async () => {
  const stack = readStackInfo();
  const run = randomUUID();
  const record = JSON.parse(await readFile(NFC_FIXTURES.td3Record, 'utf8')) as { dg1_mrz: string };
  const chip = buildUtopiaChip({
    now: new Date(),
    seed: `e2e-nfc-${run}`,
    mrzLines: [record.dg1_mrz.slice(0, 44), record.dg1_mrz.slice(44)],
    portrait: {
      bytes: await readFile(NFC_FIXTURES.portrait),
      mimeType: 'image/jp2',
      width: 480,
      height: 640,
    },
  });

  // The holder: the TD3 page, person A's selfie, then the chip.
  const holder = await startInquiry(
    stack,
    chipTemplate(`e2e-nfc-${run}`, true),
    `e2e-nfc-${run}-holder`,
  );
  const holderFlow = flowApi(stack.apiUrl, holder.sessionToken);
  await giveFlowConsent(holderFlow);
  const governmentId = await holderFlow.createVerification('government-id');
  await holderFlow.upload(governmentId, 'front', NFC_FIXTURES.td3Page);
  await holderFlow.submit(governmentId);
  expect(['passed', 'needs_review']).toContain(
    (await settledFlowVerification(holderFlow, governmentId)).attributes.status,
  );
  const holderSelfie = await phase5bFlow(stack, holder.sessionToken).submitSelfie((pose) =>
    selfieStill('a', pose),
  );
  await settledFlowVerification(holderFlow, holderSelfie);
  const read = await submitChip(holder.sessionToken, chip);
  expect((await settledFlowVerification(holderFlow, read, 60_000)).attributes.status).toBe(
    'passed',
  );

  const first = await checksOf(read);
  for (const name of DEFAULT_GOVERNMENT_ID_NFC_CHECKS.required) {
    expect(first.checks[name], name).toMatchObject({ status: 'passed', requirement: 'required' });
  }
  expect(first.checks.id_nfc_passive_authentication_detection?.metadata).toMatchObject({
    integrity: 'established',
    revocation: 'unrevoked',
    'anchor-sandbox-only': true,
  });
  expect(first.checks.id_nfc_chip_authentication_detection?.metadata).toMatchObject({
    outcome: 'verified',
    'device-reported': expect.arrayContaining(['pace']),
  });
  expect(first.checks.id_nfc_repeat_detection).toMatchObject({
    status: 'passed',
    metadata: { sightings: 0 },
  });
  expect(first.attributes).toMatchObject({
    'name-last': 'CALDERWOOD',
    'id-class': 'passport',
    'issuing-country': 'UT',
    'passive-authentication': { outcome: 'passed', integrity: 'established' },
    'active-authentication': { outcome: 'passed' },
  });
  // C51.4: no check copies a data group.
  expect(JSON.stringify(first.checks)).not.toContain('CALDERWOOD');

  // The replay: the same files in an inquiry of another account, with person B's selfie.
  const replay = await startInquiry(
    stack,
    chipTemplate(`e2e-nfc-replay-${run}`, false),
    `e2e-nfc-${run}-replay`,
  );
  const replayFlow = flowApi(stack.apiUrl, replay.sessionToken);
  await giveFlowConsent(replayFlow);
  const otherSelfie = await phase5bFlow(stack, replay.sessionToken).submitSelfie((pose) =>
    selfieStill('b', pose),
  );
  await settledFlowVerification(replayFlow, otherSelfie);
  const replayed = await submitChip(replay.sessionToken, chip);
  expect((await settledFlowVerification(replayFlow, replayed, 60_000)).attributes.status).toBe(
    'failed',
  );

  const second = await checksOf(replayed);
  expect(second.checks.id_nfc_selfie_comparison).toMatchObject({
    status: 'failed',
    reasons: ['face_mismatch'],
  });
  expect(second.checks.id_nfc_repeat_detection).toMatchObject({
    status: 'not_applicable',
    requirement: 'not_required',
    reasons: ['chip_seen_on_other_account'],
    metadata: { sightings: 1 },
  });
  // The chip itself is genuine: its integrity holds, whoever presents it.
  expect(second.checks.id_nfc_passive_authentication_detection).toMatchObject({
    status: 'passed',
  });
});
