/**
 * C66 on the verification page, for the people types (phone number, email address, crypto
 * wallet): the evidence beside the checks, each check with its category and reasons in words, a
 * limit refusal and a contract wallet as review, an advisory failure as advisory, and no masked
 * value in the page or its RSC payload, whatever the inquiry document carries.
 */
import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  SANDBOX_CONTRACT_WALLET,
  WALLET_ADDRESS,
  contractWalletVerification,
  cryptoWalletVerification,
} from '../../../testing/fixtures/crypto-wallet';
import {
  EMAIL_ADDRESS,
  deniedDomainEmailAddressVerification,
} from '../../../testing/fixtures/email-address';
import {
  PHONE_NUMBER,
  limitedPhoneNumberVerification,
  phoneNumberVerification,
} from '../../../testing/fixtures/phone-number';
import { T1 } from '../../../testing/lifecycle-fixtures';
import { servePeopleVerification } from '../../../testing/routes/people';
import { rscPayloadOf } from '../../../testing/rsc-payload';
import VerificationPage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('../../actions/auth', () => ({ logout: vi.fn() }));
vi.mock('../../actions/environment', () => ({ switchEnvironment: vi.fn() }));

const REVIEWER: Permission[] = ['verifications:read', 'inquiries:read', 'pii:view'];
const VIEWER: Permission[] = ['verifications:read', 'inquiries:read'];

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
  vi.restoreAllMocks();
});

const page = (id: string) => VerificationPage({ params: Promise.resolve({ id }) });
const region = (name: string) => screen.getByRole('region', { name });

function rowFor(name: string): HTMLElement {
  const row = screen.getByRole('rowheader', { name, hidden: true }).closest('tr');
  if (row === null) throw new Error(`No row for ${name}`);
  return row;
}

/** The value a term of the evidence names. */
function evidenceValue(term: string): HTMLElement {
  const dd = within(region('Evidence')).getByText(term, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`No value for ${term}`);
  return dd;
}

describe('a phone number verification on its page (C55, C66)', () => {
  it('says which limit refused the user, and that the comparison sends it to review (C55.6)', async () => {
    api.me({ permissions: REVIEWER });
    const verification = limitedPhoneNumberVerification();
    servePeopleVerification(api, verification);

    render(await page(verification.id));

    expect(evidenceValue('Refused by')).toHaveTextContent("The environment's text message budget");
    expect(screen.getByRole('note', { name: 'Why it needs review' })).toHaveTextContent(
      'phone_number_otp_comparison (A sending limit stopped the code)',
    );
    const comparison = rowFor('phone_number_otp_comparison');
    expect(within(comparison).getByText('Not applicable')).toBeVisible();
    expect(within(comparison).getByText('User action required')).toBeVisible();
    expect(comparison).toHaveTextContent('a reviewer decides');
  });

  it('lets no number the API masked reach the page or its payload, whatever the inquiry carries (C53.7)', async () => {
    api.me({ permissions: VIEWER });
    const verification = phoneNumberVerification({ masked: true });
    servePeopleVerification(api, verification, { seen: phoneNumberVerification() });

    const element = await page(verification.id);
    const payload = await rscPayloadOf(element);
    render(element);

    expect(within(evidenceValue('Phone number')).getByText('Hidden')).toBeVisible();
    expect(evidenceValue('Sends')).toHaveTextContent(/^2$/);
    expect(document.body.textContent).not.toContain(PHONE_NUMBER);
    expect(payload).not.toContain(PHONE_NUMBER);
  });
});

describe('an email address verification on its page (C56, C66)', () => {
  it('says the denied domain, and that its advisory failure does not decide the verification', async () => {
    api.me({ permissions: REVIEWER });
    const verification = deniedDomainEmailAddressVerification();
    servePeopleVerification(api, verification);

    render(await page(verification.id));

    expect(evidenceValue('Email address').textContent).toBe(EMAIL_ADDRESS);
    expect(evidenceValue('Disposable-domain lists')).toHaveTextContent(
      "On the template's deny list",
    );
    const disposable = rowFor('email_address_disposable_detection');
    expect(within(disposable).getByText('Advisory')).toBeVisible();
    expect(within(disposable).getByText('Does not decide the verification')).toBeVisible();
    expect(within(disposable).getByText('Disposable email domain')).toBeVisible();
    expect(within(disposable).getByText('Fraud')).toBeVisible();
    await userEvent.click(screen.getByText(/^Other checks/));
    expect(
      within(rowFor('email_address_mx_detection')).getByText('User action required'),
    ).toBeVisible();
  });
});

describe('a crypto wallet verification on its page (C57, C66)', () => {
  it('says a contract wallet, why it went to review, and its address to a reviewer', async () => {
    api.me({ permissions: REVIEWER });
    const verification = contractWalletVerification();
    servePeopleVerification(api, verification);

    const element = await page(verification.id);
    const payload = await rscPayloadOf(element);
    render(element);

    expect(evidenceValue('Wallet address').textContent).toBe(SANDBOX_CONTRACT_WALLET);
    expect(evidenceValue('Flags')).toHaveTextContent('Contract wallet (ERC-1271)');
    const address = rowFor('crypto_wallet_address_comparison');
    expect(within(address).getByText('Contract wallet, not allowed')).toBeVisible();
    expect(address).toHaveTextContent('proves control of a contract, not of a person');
    expect(within(address).getByText('Fraud')).toBeVisible();
    expect(payload).toContain(SANDBOX_CONTRACT_WALLET);
  });

  it('lets no address the API masked reach the page or its payload (C53.7)', async () => {
    api.me({ permissions: VIEWER });
    const verification = cryptoWalletVerification({
      masked: true,
      attributes: { 'expected-address': WALLET_ADDRESS },
    });
    servePeopleVerification(api, verification, {
      seen: cryptoWalletVerification({ attributes: { 'expected-address': WALLET_ADDRESS } }),
    });

    const element = await page(verification.id);
    const payload = await rscPayloadOf(element);
    render(element);

    expect(within(evidenceValue('Wallet address')).getByText('Hidden')).toBeVisible();
    expect(within(evidenceValue('Expected address')).getByText('Hidden')).toBeVisible();
    expect(document.body.textContent).not.toContain(WALLET_ADDRESS.slice(2));
    expect(payload).not.toContain(WALLET_ADDRESS.slice(2));
  });

  it('shows "Redacted" for both addresses once the inquiry was redacted (C16)', async () => {
    api.me({ permissions: REVIEWER });
    const verification = cryptoWalletVerification({ masked: true });
    servePeopleVerification(api, verification, { redactedAt: T1 });

    render(await page(verification.id));

    expect(evidenceValue('Wallet address')).toHaveTextContent(/^Redacted$/);
    expect(evidenceValue('Expected address')).toHaveTextContent(/^Redacted$/);
  });
});
