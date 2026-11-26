/**
 * `dashboard-documents`' spec helpers (Workflow 5C, C66): a proof-of-address inquiry prefilled for
 * the synthetic holder with one document attempt, a chip read the way a Phase 10 reader will send
 * one (as `nfc-chip.spec.ts` does), and what the console shows of their evidence. Every value is
 * synthetic: the holder and the issuer are invented, and the chip is a Utopia test chip.
 */
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_DOCUMENT_CHECKS,
  DEFAULT_GOVERNMENT_ID_NFC_CHECKS,
  defaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import {
  buildUtopiaChip,
  signActiveAuthentication,
  type UtopiaChip,
} from '@openverify/emrtd/testing';
import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { NFC_FIXTURES, poaFixture, selfieStill } from '../../src/paths.js';
import type { StackInfo } from '../../src/stack-info.js';
import { phase5Template, startInquiry, typeConfig } from './phase5.js';
import { phase5bFlow, startPrefilledInquiry } from './phase5b.js';
import { flowApi, giveFlowConsent, settledFlowVerification } from './platform.js';
import { signInAs } from './ui.js';

/** The holder the generated bills are addressed to, as the sidecar gives the inquiry's fields. */
export async function holderFields(): Promise<Record<string, string>> {
  const sidecar = JSON.parse(await readFile(poaFixture('en/utility-bill/happy.json'), 'utf8')) as {
    inquiry_fields: Record<string, string>;
  };
  return sidecar.inquiry_fields;
}

/**
 * A new inquiry prefilled with the holder's fields, whose proof-of-address step takes a bill or a
 * bank statement, and one document attempt with `file` through the flow API, decided.
 */
export async function documentInquiry(
  stack: StackInfo,
  name: string,
  file: string,
): Promise<{ inquiryId: string; verificationId: string; status: string }> {
  const { inquiryId, sessionToken } = await startPrefilledInquiry(
    stack,
    phase5Template(
      name,
      [
        {
          id: 'proof',
          type: 'document',
          documentTypes: ['utility_bill', 'bank_statement'],
          captureMethods: ['upload'],
        },
      ],
      { document: typeConfig(DEFAULT_DOCUMENT_CHECKS) },
    ),
    name,
    await holderFields(),
  );
  const flow = flowApi(stack.apiUrl, sessionToken);
  await giveFlowConsent(flow);
  const phase5b = phase5bFlow(stack, sessionToken);
  const verificationId = await phase5b.create('document');
  await phase5b.upload(verificationId, 'document', await readFile(file));
  await phase5b.submit(verificationId);
  const settled = await settledFlowVerification(flow, verificationId, 60_000);
  return { inquiryId, verificationId, status: settled.attributes.status };
}

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

/** The chip steps after consent: a one-sided ID (the TD3 page), the default selfie, the chip. */
function chipTemplate(name: string) {
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
      { ...governmentId, sides: 'front' as const },
      selfie,
      { id: 'nfc', type: 'nfc', androidOnly: true },
    ],
    {
      'government-id': governmentIdConfig,
      selfie: selfieConfig,
      'government-id-nfc': typeConfig(DEFAULT_GOVERNMENT_ID_NFC_CHECKS),
    },
  );
}

/**
 * A holder's inquiry: the TD3 page as a one-sided ID, person A's selfie (the sandbox upload
 * fallback), then a Utopia chip built from the page's MRZ and person A's JPEG 2000 portrait,
 * answered over the server's nonce with the chip's Active Authentication key and a device report.
 */
export async function chipInquiry(
  stack: StackInfo,
  name: string,
): Promise<{ inquiryId: string; verificationId: string; selfieVerificationId: string }> {
  const record = JSON.parse(await readFile(NFC_FIXTURES.td3Record, 'utf8')) as { dg1_mrz: string };
  const chip = buildUtopiaChip({
    now: new Date(),
    seed: name,
    mrzLines: [record.dg1_mrz.slice(0, 44), record.dg1_mrz.slice(44)],
    portrait: {
      bytes: await readFile(NFC_FIXTURES.portrait),
      mimeType: 'image/jp2',
      width: 480,
      height: 640,
    },
  });
  const { inquiryId, sessionToken } = await startInquiry(stack, chipTemplate(name), name);
  const flow = flowApi(stack.apiUrl, sessionToken);
  await giveFlowConsent(flow);
  const governmentId = await flow.createVerification('government-id');
  await flow.upload(governmentId, 'front', NFC_FIXTURES.td3Page);
  await flow.submit(governmentId);
  await settledFlowVerification(flow, governmentId);
  const phase5b = phase5bFlow(stack, sessionToken);
  const selfieVerificationId = await phase5b.submitSelfie((pose) => selfieStill('a', pose));
  await settledFlowVerification(flow, selfieVerificationId);

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
  await settledFlowVerification(flow, verificationId, 60_000);
  return { inquiryId, verificationId, selfieVerificationId };
}

/** A verification's evidence in the console (C54.5): the group named after its card or page. */
export function evidence(page: Page, label: string): Locator {
  return page.getByRole('group', { name: `${label} evidence` });
}

/** The value (`<dd>`) of a term (`<dt>`) inside `scope`. */
export function term(scope: Locator, name: string): Locator {
  return scope.locator(`dt:text-is("${name}") + dd`);
}

/**
 * The row of `table` whose row header matches `name`. The inner locator starts at the page: a
 * `has` locator is matched inside each row, so one built from the table would never match.
 */
export function tableRow(table: Locator, name: string | RegExp): Locator {
  return table.getByRole('row').filter({ has: table.page().getByRole('rowheader', { name }) });
}

/**
 * Waits until an image has decoded through the dashboard's authenticated file route. An image
 * that is not on the page fails at once, by name, instead of at the test's timeout.
 */
export async function expectImageLoaded(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
}

/** The seeded roles these specs read the console as. */
export type ConsoleRole = 'reviewer' | 'viewer';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * The dashboard's session cookie (`apps/dashboard/src/lib/session-cookie.ts`): the e2e stack serves
 * a production build, whose session cookie is Secure and so named with the `__Host-` prefix (KP11-78).
 */
const SESSION_COOKIE = '__Host-openverify_session';

/**
 * Signs each role in once, through the dashboard, and keeps its session. Every sign-in attempt
 * counts against the API's login limits (C4: 10 per email and 50 per address in 15 minutes), and
 * the whole full-stack suite shares them, so a spec signs each role in only once.
 */
export async function signedInStates(
  browser: Browser,
  stack: StackInfo,
  roles: readonly ConsoleRole[],
): Promise<Record<ConsoleRole, StorageState>> {
  const states: Partial<Record<ConsoleRole, StorageState>> = {};
  for (const role of roles) {
    const context = await browser.newContext();
    try {
      await signInAs(await context.newPage(), stack, role);
      states[role] = await context.storageState();
    } finally {
      await context.close();
    }
  }
  return states as Record<ConsoleRole, StorageState>;
}

/** A page signed in with a kept session; close its context when done. */
export async function consolePage(
  browser: Browser,
  state: StorageState,
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ storageState: state });
  return { page: await context.newPage(), context };
}

/** The `ovu_` session token of a kept session, which the dashboard API also accepts. */
export function sessionTokenOf(state: StorageState): string {
  const cookie = state.cookies.find((entry) => entry.name === SESSION_COOKIE);
  if (cookie === undefined) {
    throw new Error('The kept session has no session cookie');
  }
  return cookie.value;
}
