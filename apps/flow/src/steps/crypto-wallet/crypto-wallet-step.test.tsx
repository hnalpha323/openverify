import type { RetryHint } from '@openverify/contracts';
import type { Flow } from '@openverify/flow-spec';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../../api/flow-api-client';
import type { CryptoWalletStep as WalletStep, FlowPosition } from '../../flow/flow-position';
import { FakeFlowApi } from '../../testing/fake-flow-api';
import { wholeText } from '../../testing/flow-renderer';
import { goldenFlowError } from '../../testing/golden-problems';
import { renderWithFlow } from '../../test-utils';
import { CryptoWalletStep } from './crypto-wallet-step';

type CapturePosition = Extract<FlowPosition, { kind: 'capture' }> & { step: WalletStep };

const ETHEREUM = 'eip155:1';
const BITCOIN = 'bip122:000000000019d6689c085ae165831e93';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
/** Synthetic values: no key exists for this address, and the fake API checks no signature. */
const ADDRESS = '0x5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e';
const SIGNATURE = `0x${'5e'.repeat(65)}`;
const BITCOIN_ADDRESS = 'bc1qsyntheticaddressforflowtestsonly000000';
const PASTED_SIGNATURE = `smp${'A'.repeat(88)}`;

const WALLET: WalletStep = {
  id: 'wallet',
  type: 'crypto_wallet',
  chains: [ETHEREUM],
  signing: ['wallet', 'paste'],
};

const MISMATCH: RetryHint = {
  name: 'crypto_wallet_address_comparison',
  reasons: ['signature_address_mismatch'],
};

interface RequestArguments {
  readonly method: string;
  readonly params?: readonly unknown[];
}

/** A fake EIP-1193 provider: one account, and a fixed signature for `personal_sign`. */
function fakeProvider() {
  return {
    request: vi.fn((args: RequestArguments): Promise<unknown> => {
      if (args.method === 'eth_requestAccounts') {
        return Promise.resolve([ADDRESS]);
      }
      if (args.method === 'personal_sign') {
        return Promise.resolve(SIGNATURE);
      }
      return Promise.reject(Object.assign(new Error('Unsupported method'), { code: 4200 }));
    }),
  };
}

type FakeProvider = ReturnType<typeof fakeProvider>;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/** A wallet that answers EIP-6963's request with its announcement, as extensions do. */
function announce(
  provider: FakeProvider,
  name = 'Test Wallet',
  uuid = 'f3c1d1b0-0000-4000-8000-000000000001',
) {
  const listener = () => {
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({
          info: { uuid, name, icon: 'data:image/svg+xml,<svg/>', rdns: 'test.wallet' },
          provider,
        }),
      }),
    );
  };
  window.addEventListener('eip6963:requestProvider', listener);
  cleanups.push(() => {
    window.removeEventListener('eip6963:requestProvider', listener);
  });
}

/** An injected `window.ethereum`, the fallback without EIP-6963. */
function inject(provider: FakeProvider) {
  Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
  cleanups.push(() => {
    Reflect.deleteProperty(window, 'ethereum');
  });
}

function stubClipboard(writeText = vi.fn(() => Promise.resolve())) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  cleanups.push(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });
  return writeText;
}

function flowWith(step: WalletStep): Flow {
  return {
    metadata: { specVersion: 1, id: 'wallet', version: 1, name: 'Wallet' },
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      step,
      { id: 'done', type: 'completion' },
    ],
    transitions: [],
  };
}

function capture(step: WalletStep, overrides: Partial<CapturePosition> = {}): CapturePosition {
  return {
    kind: 'capture',
    step,
    attempt: 1,
    maxAttempts: 3,
    verificationId: null,
    hints: [],
    ...overrides,
  };
}

function renderStep(
  position: CapturePosition,
  { api = new FakeFlowApi(), language = 'en' }: { api?: FakeFlowApi; language?: 'en' | 'es' } = {},
) {
  api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
  api.flow = flowWith(position.step);
  const onSubmitted = vi.fn(() => Promise.resolve());
  renderWithFlow(
    <CryptoWalletStep position={position} client={api.client} onSubmitted={onSubmitted} />,
    { language, environment: { currentTime: () => api.nowMs } },
  );
  return { api, onSubmitted };
}

/** The message as `personal_sign` takes it: its UTF-8 bytes in hexadecimal. */
function hex(message: string): string {
  return `0x${Array.from(new TextEncoder().encode(message), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`;
}

async function pasteAddress(address: string) {
  await userEvent.type(await screen.findByRole('textbox', { name: 'Wallet address' }), address);
  await userEvent.click(screen.getByRole('button', { name: 'Get the message to sign' }));
}

async function pasteSignature(signature: string) {
  await userEvent.type(await screen.findByRole('textbox', { name: 'Signature' }), signature);
  await userEvent.click(screen.getByRole('button', { name: 'Submit signature' }));
}

describe('CryptoWalletStep (C57, C64.1)', () => {
  it('explains the step and names its one network', () => {
    renderStep(capture(WALLET));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Prove that you control your crypto wallet' }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'You sign a message with your wallet. Signing a message is free: it sends no transaction and moves no funds.',
      ),
    ).toBeVisible();
    expect(screen.getByText(wholeText('Network: Ethereum'))).toBeVisible();
    expect(screen.getByText('Attempt 1 of 3')).toBeVisible();
  });

  it('offers the step’s networks to choose from', async () => {
    renderStep(capture({ ...WALLET, chains: [ETHEREUM, BITCOIN, 'eip155:137', 'eip155:424242'] }));

    const group = screen.getByRole('radiogroup', { name: 'Network' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent),
    ).toEqual(['Ethereum', 'Bitcoin', 'Polygon', 'EVM network 424242']);
    expect(within(group).getByRole('radio', { name: 'Ethereum' })).toBeChecked();
    await userEvent.click(within(group).getByRole('radio', { name: 'Bitcoin' }));
    expect(within(group).getByRole('radio', { name: 'Bitcoin' })).toBeChecked();
  });

  describe('with a browser wallet (EIP-1193)', () => {
    it('signs the server’s message in an announced wallet, then submits the signature (EIP-6963)', async () => {
      const provider = fakeProvider();
      announce(provider);
      const { api, onSubmitted } = renderStep(capture(WALLET));

      await userEvent.click(await screen.findByRole('button', { name: 'Connect Test Wallet' }));

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });
      const [verification] = api.verifications;
      const challenge = verification?.challenges?.[0];
      expect(api.client.createVerification).toHaveBeenCalledWith(
        { type: 'crypto-wallet' },
        expect.any(AbortSignal),
      );
      expect(api.client.createCryptoChallenge.mock.calls.map(([id, body]) => [id, body])).toEqual([
        [verification?.id, { 'chain-id': ETHEREUM, 'wallet-address': ADDRESS }],
      ]);
      expect(provider.request.mock.calls.map(([args]) => args)).toEqual([
        { method: 'eth_requestAccounts' },
        { method: 'personal_sign', params: [hex(challenge?.message ?? ''), ADDRESS] },
      ]);
      expect(api.submits).toEqual([
        {
          verificationId: verification?.id,
          body: {
            crypto: { 'challenge-id': challenge?.id, signature: SIGNATURE, scheme: 'eip191' },
          },
        },
      ]);
    });

    it('uses an injected window.ethereum when no wallet announces itself', async () => {
      const provider = fakeProvider();
      inject(provider);
      const { onSubmitted } = renderStep(capture(WALLET));

      await userEvent.click(await screen.findByRole('button', { name: 'Connect your wallet' }));

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });
      expect(provider.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
    });

    it('lets the user choose among the wallets that announced themselves', async () => {
      const first = fakeProvider();
      const second = fakeProvider();
      announce(first, 'First Wallet', 'f3c1d1b0-0000-4000-8000-000000000001');
      announce(second, 'Second Wallet', 'f3c1d1b0-0000-4000-8000-000000000002');
      const { onSubmitted } = renderStep(capture(WALLET));

      expect(await screen.findByRole('button', { name: 'Connect First Wallet' })).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Connect Second Wallet' }));

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });
      expect(first.request).not.toHaveBeenCalled();
      expect(second.request).toHaveBeenCalledTimes(2);
    });

    it('ignores an announcement without a usable provider', async () => {
      const listener = () => {
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', {
            detail: { info: { uuid: 'x', name: 'Broken Wallet' }, provider: {} },
          }),
        );
      };
      window.addEventListener('eip6963:requestProvider', listener);
      cleanups.push(() => {
        window.removeEventListener('eip6963:requestProvider', listener);
      });
      renderStep(capture(WALLET));

      expect(await screen.findByRole('textbox', { name: 'Wallet address' })).toBeVisible();
      expect(screen.queryByRole('button', { name: /Connect/ })).not.toBeInTheDocument();
    });

    it.each([
      [
        'eth_requestAccounts',
        4001,
        'You declined the request in your wallet. Try again when you are ready.',
      ],
      [
        'personal_sign',
        4001,
        'You declined the request in your wallet. Try again when you are ready.',
      ],
      [
        'personal_sign',
        -32603,
        'Your wallet could not complete the request. Try again, or paste a signature instead.',
      ],
    ])(
      'explains a %s that ended with error %d, then tries again',
      async (method, code, message) => {
        const provider = fakeProvider();
        const answer = provider.request.getMockImplementation();
        provider.request.mockImplementationOnce((args: RequestArguments) =>
          args.method === method
            ? Promise.reject(Object.assign(new Error('Wallet error'), { code }))
            : (answer?.(args) ?? Promise.resolve(null)),
        );
        if (method === 'personal_sign') {
          provider.request.mockImplementationOnce((args: RequestArguments) =>
            args.method === method
              ? Promise.reject(Object.assign(new Error('Wallet error'), { code }))
              : (answer?.(args) ?? Promise.resolve(null)),
          );
        }
        announce(provider);
        const { api, onSubmitted } = renderStep(capture(WALLET));

        await userEvent.click(await screen.findByRole('button', { name: 'Connect Test Wallet' }));

        expect(await screen.findByText(message)).toBeVisible();
        expect(api.client.submitVerification).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Connect Test Wallet' }));
        await waitFor(() => {
          expect(onSubmitted).toHaveBeenCalledTimes(1);
        });
      },
    );

    it('refuses an account that is not an EVM address', async () => {
      const provider = fakeProvider();
      provider.request.mockImplementationOnce(() => Promise.resolve(['not-an-address']));
      announce(provider);
      const { api } = renderStep(capture(WALLET));

      await userEvent.click(await screen.findByRole('button', { name: 'Connect Test Wallet' }));

      expect(
        await screen.findByText(
          'Your wallet could not complete the request. Try again, or paste a signature instead.',
        ),
      ).toBeVisible();
      expect(api.client.createCryptoChallenge).not.toHaveBeenCalled();
    });

    it('reloads the session when connecting asks for the attempt’s eleventh message (C57.2, Workflow 5C review P026)', async () => {
      const provider = fakeProvider();
      announce(provider);
      const { api, onSubmitted } = renderStep(capture(WALLET));
      api.failures.createCryptoChallenge = [goldenFlowError('crypto_challenge_invalid')];

      await userEvent.click(await screen.findByRole('button', { name: 'Connect Test Wallet' }));

      // The canceled attempt is read again at once, not taken for an expired message.
      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });
      expect(
        screen.queryByText(
          'This message has expired or was already used. Get a new message to sign.',
        ),
      ).not.toBeInTheDocument();
      expect(provider.request.mock.calls.map(([args]) => args.method)).toEqual([
        'eth_requestAccounts',
      ]);
    });

    it('asks for a new message when the server refuses the signed one (Workflow 5C review P026)', async () => {
      announce(fakeProvider());
      const { api, onSubmitted } = renderStep(capture(WALLET));
      api.failures.submitVerification = [goldenFlowError('crypto_challenge_invalid')];

      await userEvent.click(await screen.findByRole('button', { name: 'Connect Test Wallet' }));

      expect(
        await screen.findByText(
          'This message has expired or was already used. Get a new message to sign.',
        ),
      ).toBeVisible();
      expect(onSubmitted).not.toHaveBeenCalled();
    });

    it('offers the paste path instead, and back', async () => {
      announce(fakeProvider());
      renderStep(capture(WALLET));

      await userEvent.click(
        await screen.findByRole('button', { name: 'Paste a signature instead' }),
      );
      expect(screen.getByRole('textbox', { name: 'Wallet address' })).toBeVisible();
      await userEvent.click(
        screen.getByRole('button', { name: 'Use your browser wallet instead' }),
      );

      expect(screen.getByRole('button', { name: 'Connect Test Wallet' })).toBeVisible();
    });

    it('offers no wallet for a network that is not an EVM chain', async () => {
      announce(fakeProvider());
      renderStep(capture({ ...WALLET, chains: [BITCOIN] }));

      expect(await screen.findByRole('textbox', { name: 'Wallet address' })).toBeVisible();
      expect(screen.queryByRole('button', { name: /Connect/ })).not.toBeInTheDocument();
    });

    it('needs a browser wallet when the step takes no pasted signature', () => {
      renderStep(capture({ ...WALLET, signing: ['wallet'] }));

      expect(
        screen.getByText(
          'This step needs a browser wallet. Open this page in a browser with a wallet extension, or in your wallet app’s browser.',
        ),
      ).toBeVisible();
      expect(screen.queryByRole('textbox', { name: 'Wallet address' })).not.toBeInTheDocument();
    });
  });

  describe('pasting a signature', () => {
    it('gets the message for the address, copies it, and submits the pasted signature', async () => {
      const writeText = stubClipboard();
      const { api, onSubmitted } = renderStep(capture({ ...WALLET, chains: [BITCOIN] }));

      await pasteAddress(BITCOIN_ADDRESS);

      const [verification] = api.verifications;
      const challenge = verification?.challenges?.[0];
      const message = await screen.findByRole('textbox', { name: 'Message to sign' });
      expect(message).toHaveValue(challenge?.message);
      expect(message).toHaveAttribute('readonly');
      const expiry = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(
        new Date(challenge?.expiresAtMs ?? 0),
      );
      expect(
        screen.getByText(
          `Sign this exact message in your wallet, then paste the signature below. Sign it before ${expiry}.`,
        ),
      ).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Copy the message' }));
      expect(writeText).toHaveBeenCalledWith(challenge?.message);
      expect(await screen.findByText('Message copied.')).toHaveAttribute('role', 'status');
      await pasteSignature(` ${PASTED_SIGNATURE} `);

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });
      expect(api.client.createCryptoChallenge.mock.calls[0]?.[1]).toEqual({
        'chain-id': BITCOIN,
        'wallet-address': BITCOIN_ADDRESS,
      });
      // The server reads the scheme from the signature: the browser names none.
      expect(api.submits).toEqual([
        {
          verificationId: verification?.id,
          body: { crypto: { 'challenge-id': challenge?.id, signature: PASTED_SIGNATURE } },
        },
      ]);
    });

    it('says when the message cannot be copied', async () => {
      stubClipboard(vi.fn(() => Promise.reject(new Error('denied'))));
      renderStep(capture({ ...WALLET, chains: [BITCOIN] }));
      await pasteAddress(BITCOIN_ADDRESS);

      await userEvent.click(await screen.findByRole('button', { name: 'Copy the message' }));

      expect(
        await screen.findByText('We could not copy the message. Select it and copy it yourself.'),
      ).toBeVisible();
    });

    it('takes the bytes a Solana wallet signed, when the user has them', async () => {
      const { api, onSubmitted } = renderStep(capture({ ...WALLET, chains: [SOLANA] }));
      await pasteAddress('So1anaSyntheticAddressForFlowTestsOnly1111');

      const signed = await screen.findByRole('textbox', { name: 'Signed message (optional)' });
      expect(signed).toHaveAccessibleDescription(
        'Some Solana wallets show the bytes they signed. If yours does, paste them here.',
      );
      await userEvent.type(signed, 'c2lnbmVkIGJ5dGVz');
      await pasteSignature('5ynthetic5ignature');

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });
      expect(api.submits[0]?.body?.crypto).toEqual({
        'challenge-id': api.verifications[0]?.challenges?.[0]?.id,
        signature: '5ynthetic5ignature',
        'signed-message': 'c2lnbmVkIGJ5dGVz',
      });
    });

    it('asks for no signed message on other networks', async () => {
      renderStep(capture({ ...WALLET, chains: [BITCOIN] }));
      await pasteAddress(BITCOIN_ADDRESS);

      await screen.findByRole('textbox', { name: 'Signature' });
      expect(
        screen.queryByRole('textbox', { name: 'Signed message (optional)' }),
      ).not.toBeInTheDocument();
    });

    it('asks for the address and the signature before any request', async () => {
      const { api } = renderStep(capture({ ...WALLET, chains: [BITCOIN] }));

      await userEvent.click(screen.getByRole('button', { name: 'Get the message to sign' }));

      const address = screen.getByRole('textbox', { name: 'Wallet address' });
      expect(address).toHaveAttribute('aria-invalid', 'true');
      expect(address).toHaveAccessibleDescription(
        'Copy it from your wallet, then paste it here. Enter your wallet address.',
      );
      expect(api.client.createCryptoChallenge).not.toHaveBeenCalled();

      await pasteAddress(BITCOIN_ADDRESS);
      await userEvent.click(await screen.findByRole('button', { name: 'Submit signature' }));

      expect(screen.getByRole('textbox', { name: 'Signature' })).toHaveAccessibleDescription(
        'Paste the signature from your wallet.',
      );
      expect(api.client.submitVerification).not.toHaveBeenCalled();
    });

    it.each([
      [
        'crypto_address_invalid',
        'This wallet address is not valid for the network you chose. Check that you copied the whole address.',
      ],
      [
        'crypto_expected_address_mismatch',
        'This is not the wallet address you were asked to verify. Use the expected wallet address.',
      ],
    ])('explains an address the server refuses with %s', async (code, message) => {
      const { api } = renderStep(capture({ ...WALLET, chains: [BITCOIN] }));
      api.failures.createCryptoChallenge = [goldenFlowError(code)];

      await pasteAddress(BITCOIN_ADDRESS);

      const address = await screen.findByRole('textbox', { name: 'Wallet address' });
      await waitFor(() => {
        expect(address).toHaveAttribute('aria-invalid', 'true');
      });
      expect(address).toHaveAccessibleDescription(
        `Copy it from your wallet, then paste it here. ${message}`,
      );
    });

    it('explains a network the server does not offer', async () => {
      const { api } = renderStep(capture({ ...WALLET, chains: [BITCOIN] }));
      api.failures.createCryptoChallenge = [goldenFlowError('crypto_chain_not_offered')];

      await pasteAddress(BITCOIN_ADDRESS);

      expect(
        await screen.findByText('This network is not accepted here. Choose another network.'),
      ).toBeVisible();
    });

    it('gets a new message when the server refuses the signed one', async () => {
      const { api, onSubmitted } = renderStep(capture({ ...WALLET, chains: [BITCOIN] }));
      await pasteAddress(BITCOIN_ADDRESS);
      api.nowMs += 600_000;

      await pasteSignature(PASTED_SIGNATURE);

      expect(
        await screen.findByText(
          'This message has expired or was already used. Get a new message to sign.',
        ),
      ).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'Wallet address' })).toHaveValue(BITCOIN_ADDRESS);
      await userEvent.click(screen.getByRole('button', { name: 'Get the message to sign' }));
      await pasteSignature(PASTED_SIGNATURE);

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });
      expect(api.verifications[0]?.challenges?.map(({ status }) => status)).toEqual([
        'superseded',
        'submitted',
      ]);
    });

    it('lets the user sign with a different address', async () => {
      renderStep(capture({ ...WALLET, chains: [BITCOIN] }));
      await pasteAddress(BITCOIN_ADDRESS);

      await userEvent.click(await screen.findByRole('button', { name: 'Use a different address' }));

      expect(screen.getByRole('textbox', { name: 'Wallet address' })).toHaveValue(BITCOIN_ADDRESS);
      expect(screen.queryByRole('textbox', { name: 'Message to sign' })).not.toBeInTheDocument();
    });

    it('reloads the session when the attempt’s messages ran out (the eleventh, C57.2)', async () => {
      const { api, onSubmitted } = renderStep(capture({ ...WALLET, chains: [BITCOIN] }));
      api.failures.createCryptoChallenge = [goldenFlowError('crypto_challenge_invalid')];

      await pasteAddress(BITCOIN_ADDRESS);

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });
    });

    it('says a refusal it has no words for without speaking of photos', async () => {
      const { api } = renderStep(capture({ ...WALLET, chains: [BITCOIN] }));
      api.failures.createCryptoChallenge = [
        new FlowApiError('http', 'POST /crypto-challenges failed', { status: 422 }),
      ];

      await pasteAddress(BITCOIN_ADDRESS);

      expect(
        await screen.findByText('This was not accepted. Check what you entered and try again.'),
      ).toBeVisible();
      expect(screen.queryByText(/photo/u)).not.toBeInTheDocument();
    });

    it('explains a request that failed, and asks again on request', async () => {
      const { api } = renderStep(capture({ ...WALLET, chains: [BITCOIN] }));
      api.failures.createCryptoChallenge = [new FlowApiError('network', 'POST failed')];

      await pasteAddress(BITCOIN_ADDRESS);

      expect(
        await screen.findByText(
          'We could not reach the verification service. Check your connection and try again.',
        ),
      ).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Get the message to sign' }));
      expect(await screen.findByRole('textbox', { name: 'Message to sign' })).toBeVisible();
    });
  });

  describe('answers the GREEN code gives beyond the RED cases (pins)', () => {
    it('says an address refusal on the wallet path', async () => {
      announce(fakeProvider());
      const { api } = renderStep(capture(WALLET));
      api.failures.createCryptoChallenge = [goldenFlowError('crypto_expected_address_mismatch')];

      await userEvent.click(await screen.findByRole('button', { name: 'Connect Test Wallet' }));

      expect(
        await screen.findByText(
          'This is not the wallet address you were asked to verify. Use the expected wallet address.',
        ),
      ).toBeVisible();
    });

    it('refuses a wallet answer that is not a signature', async () => {
      const provider = fakeProvider();
      provider.request.mockImplementation((args: RequestArguments) =>
        Promise.resolve(args.method === 'eth_requestAccounts' ? [ADDRESS] : 42),
      );
      announce(provider);
      const { api } = renderStep(capture({ ...WALLET, signing: ['wallet'] }));

      await userEvent.click(await screen.findByRole('button', { name: 'Connect Test Wallet' }));

      expect(
        await screen.findByText('Your wallet could not complete the request. Try again.'),
      ).toBeVisible();
      expect(api.client.submitVerification).not.toHaveBeenCalled();
    });

    it.each([
      ['an address with a space', 'bc1q synthetic'],
      ['an address over 128 characters', `bc1q${'q'.repeat(125)}`],
    ])('refuses %s without a request', async (_label, address) => {
      const { api } = renderStep(capture({ ...WALLET, chains: [BITCOIN] }));

      await pasteAddress(address);

      expect(screen.getByRole('textbox', { name: 'Wallet address' })).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(api.client.createCryptoChallenge).not.toHaveBeenCalled();
    });

    it('refuses a signature over 1,024 characters without a request', async () => {
      const { api } = renderStep(capture({ ...WALLET, chains: [BITCOIN] }));
      await pasteAddress(BITCOIN_ADDRESS);

      const field = await screen.findByRole('textbox', { name: 'Signature' });
      await userEvent.click(field);
      await userEvent.paste('s'.repeat(1025));
      await userEvent.click(screen.getByRole('button', { name: 'Submit signature' }));

      expect(field).toHaveAccessibleDescription(
        'This signature is too long. Paste only the signature.',
      );
      expect(api.client.submitVerification).not.toHaveBeenCalled();
    });

    it('explains a submit that never reached the server', async () => {
      const { api } = renderStep(capture({ ...WALLET, chains: [BITCOIN] }));
      await pasteAddress(BITCOIN_ADDRESS);
      api.failures.submitVerification = [new FlowApiError('network', 'POST /submit failed')];

      await pasteSignature(PASTED_SIGNATURE);

      expect(
        await screen.findByText(
          'We could not reach the verification service. Check your connection and try again.',
        ),
      ).toBeVisible();
    });

    it('ignores announcements without a detail or a uuid', async () => {
      const listener = () => {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: null }));
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', {
            detail: { info: { name: 'No Id' }, provider: fakeProvider() },
          }),
        );
      };
      window.addEventListener('eip6963:requestProvider', listener);
      cleanups.push(() => {
        window.removeEventListener('eip6963:requestProvider', listener);
      });
      renderStep(capture(WALLET));

      expect(await screen.findByRole('textbox', { name: 'Wallet address' })).toBeVisible();
    });
  });

  it('says why the attempt was started again (C64.1)', () => {
    renderStep(capture(WALLET, { attempt: 2, restarted: true }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your last attempt ended because too many messages to sign were asked for. Start again.',
    );
  });

  it('shows why the previous attempt failed', () => {
    renderStep(capture(WALLET, { attempt: 2, hints: [MISMATCH] }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The message was signed by a different wallet address. Sign it with the address you entered.',
    );
  });

  it('reuses the initiated verification it resumes', async () => {
    const api = new FakeFlowApi();
    api.flow = flowWith({ ...WALLET, chains: [BITCOIN] });
    api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
    const created = await api.client.createVerification({ type: 'crypto-wallet' });
    api.client.createVerification.mockClear();
    renderStep(capture({ ...WALLET, chains: [BITCOIN] }, { verificationId: created.id }), { api });

    await pasteAddress(BITCOIN_ADDRESS);

    expect(await screen.findByRole('textbox', { name: 'Message to sign' })).toBeVisible();
    expect(api.client.createVerification).not.toHaveBeenCalled();
    expect(api.client.createCryptoChallenge.mock.calls[0]?.[0]).toBe(created.id);
  });

  it('speaks Spanish', () => {
    renderStep(capture(WALLET), { language: 'es' });

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Demuestra que controlas tu monedero de criptomonedas',
      }),
    ).toBeVisible();
    expect(screen.getByText(wholeText('Red: Ethereum'))).toBeVisible();
  });
});

/**
 * WCAG 2.2 AA (3.3.1, 4.1.3; C64.1): a field's error is its description, not a live region, so
 * focus moves to the field that holds it, and a screen reader reads the error with the field.
 */
describe('CryptoWalletStep: focus on what was refused (C64.1, WCAG 2.2 AA)', () => {
  it('moves focus to an address the browser refuses', async () => {
    renderStep(capture({ ...WALLET, chains: [BITCOIN] }));

    await userEvent.click(screen.getByRole('button', { name: 'Get the message to sign' }));

    expect(screen.getByRole('textbox', { name: 'Wallet address' })).toHaveFocus();
  });

  it('moves focus to an address the server refuses', async () => {
    const { api } = renderStep(capture({ ...WALLET, chains: [BITCOIN] }));
    api.failures.createCryptoChallenge = [goldenFlowError('crypto_address_invalid')];

    await pasteAddress(BITCOIN_ADDRESS);

    const address = screen.getByRole('textbox', { name: 'Wallet address' });
    await waitFor(() => {
      expect(address).toHaveAttribute('aria-invalid', 'true');
    });
    expect(address).toHaveFocus();
  });

  it('moves focus to a signature the browser refuses', async () => {
    renderStep(capture({ ...WALLET, chains: [BITCOIN] }));
    await pasteAddress(BITCOIN_ADDRESS);

    await userEvent.click(await screen.findByRole('button', { name: 'Submit signature' }));

    expect(screen.getByRole('textbox', { name: 'Signature' })).toHaveFocus();
  });
});
