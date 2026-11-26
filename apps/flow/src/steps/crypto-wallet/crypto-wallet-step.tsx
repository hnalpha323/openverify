import {
  createCryptoChallengeBodySchema,
  flowCryptoSubmitSchema,
  type FlowCryptoChallengeResponse,
} from '@openverify/contracts';
import { Alert, Button, Card, Field, Input } from '@openverify/ui';
import type { TFunction } from 'i18next';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../session/use-intl-locale';
import { useIsolatedT } from '../../i18n/bidi';
import { entryErrorMessageKey } from '../../api/error-message';
import type { FlowApiClient } from '../../api/flow-api-client';
import { isConflict, problemCode } from '../../api/problem-members';
import { RetryHints } from '../../components/retry-hints';
import { TextAreaField } from '../../components/text-area-field';
import type {
  CryptoWalletStep as CryptoWalletFlowStep,
  FlowPosition,
} from '../../flow/flow-position';
import { ensureVerification, newSubmissionProgress } from '../../flow/submit-verification';
import {
  WalletRequestError,
  useBrowserWallets,
  utf8Hex,
  walletRequest,
  type BrowserWallet,
} from './browser-wallets';
import { chainName, isEvmChain, isSolanaChain } from './chains';

export interface CryptoWalletStepProps {
  /** A crypto wallet step (C57, C64.1). */
  readonly position: Extract<FlowPosition, { kind: 'capture' }> & {
    readonly step: CryptoWalletFlowStep;
  };
  readonly client: FlowApiClient;
  /** Reloads the session once the verification is submitted, or moved on at the server. */
  readonly onSubmitted: () => Promise<void>;
}

type AddressError = 'addressRequired' | 'addressInvalid' | 'addressNotExpected';
type SignatureError = 'signatureRequired' | 'signatureTooLong';

/** What the screen says went wrong, in its own words or in `entryErrorMessageKey`'s. */
type Problem =
  | { readonly kind: 'message'; readonly key: StepMessage }
  | { readonly kind: 'request'; readonly error: unknown };

type StepMessage =
  | 'wallet.declined'
  | 'wallet.failed'
  | 'wallet.failedNoPaste'
  | 'errors.chainNotOffered'
  | 'errors.challengeInvalid'
  | `errors.${AddressError}`;

/** C57.2: the challenge refusals that are about the address the user gave. */
const ADDRESS_REFUSALS: Readonly<Record<string, AddressError>> = {
  crypto_address_invalid: 'addressInvalid',
  crypto_expected_address_mismatch: 'addressNotExpected',
};

/** C57.1 bounds, as the request schemas cap them (`CRYPTO_INPUT_LIMITS`). */
const ADDRESS_MAX_LENGTH = createCryptoChallengeBodySchema.shape['wallet-address'].maxLength ?? 128;
const SIGNATURE_MAX_LENGTH = flowCryptoSubmitSchema.shape.signature.maxLength ?? 1024;

/** C57.1: an EVM account as a wallet returns it. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

function chainLabel(t: TFunction, chainId: string): string {
  const name = chainName(chainId);
  if (name.key === null) {
    return name.id;
  }
  if (name.key === 'evm') {
    return t('cryptoWallet.chains.evm', { number: name.number });
  }
  return t(`cryptoWallet.chains.${name.key}`);
}

/**
 * One attempt of a crypto wallet step (C57, C64.1). On an EVM network with `wallet` signing and a
 * browser wallet (EIP-6963, else `window.ethereum`), the wallet gives the account, the server
 * builds the message, the wallet signs it with `personal_sign`, and the signature is submitted as
 * `eip191`. Otherwise, with `paste` signing, the user pastes the address, copies the server's
 * message into their wallet and pastes the signature back. The browser verifies nothing: the
 * server does (C57.4).
 */
export function CryptoWalletStep({ position, client, onSubmitted }: CryptoWalletStepProps) {
  const { t } = useTranslation();
  const intlTag = useIntlLocale();
  // C161.3 (Workflow 9A): every interpolated value in its own <bdi>.
  const tb = useIsolatedT();
  const { step, attempt, maxAttempts, hints, verificationId, restarted } = position;
  const wallets = useBrowserWallets();
  const [chain, setChain] = useState(step.chains[0] ?? '');
  const [preferPaste, setPreferPaste] = useState(false);
  const [address, setAddress] = useState('');
  const [addressError, setAddressError] = useState<AddressError | null>(null);
  const [challenge, setChallenge] = useState<FlowCryptoChallengeResponse | null>(null);
  const [signature, setSignature] = useState('');
  const [signatureError, setSignatureError] = useState<SignatureError | null>(null);
  const [signedMessage, setSignedMessage] = useState('');
  const [copy, setCopy] = useState<'copied' | 'copyFailed' | null>(null);
  const [busy, setBusy] = useState<
    'connecting' | 'signing' | 'submitting' | 'gettingMessage' | null
  >(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const progress = useRef(newSubmissionProgress(verificationId));
  const controller = useRef<AbortController | null>(null);
  const networkId = useId();
  const card = useRef<HTMLElement>(null);
  /** Bumped with each refused address or signature, so its field takes focus (WCAG 3.3.1). */
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  // A field's error is its description, not a live region: the field takes focus, so a screen
  // reader reads the error with it.
  useEffect(() => {
    if (focusRequest > 0) {
      card.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [focusRequest]);

  const showAddressError = (error: AddressError) => {
    setAddressError(error);
    setFocusRequest((count) => count + 1);
  };

  const showSignatureError = (error: SignatureError) => {
    setSignatureError(error);
    setFocusRequest((count) => count + 1);
  };

  const pasteAllowed = step.signing.includes('paste');
  const walletUsable = step.signing.includes('wallet') && isEvmChain(chain) && wallets.length > 0;
  const mode =
    walletUsable && !(preferPaste && pasteAllowed) ? 'wallet' : pasteAllowed ? 'paste' : 'none';

  /** A fresh signal, the previous request aborted, and whether this one was aborted since. */
  const nextRequest = () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    return { signal: current.signal, aborted: () => current.signal.aborted };
  };

  /** Says an API refusal where the user can act on it; the session moves on after a 409. */
  const refused = async (error: unknown, aborted: () => boolean) => {
    const code = problemCode(error) ?? '';
    const onAddress = ADDRESS_REFUSALS[code];
    if (onAddress !== undefined) {
      if (mode === 'paste') {
        showAddressError(onAddress);
      } else {
        setProblem({ kind: 'message', key: `errors.${onAddress}` });
      }
      return;
    }
    if (code === 'crypto_chain_not_offered') {
      setProblem({ kind: 'message', key: 'errors.chainNotOffered' });
      return;
    }
    if (isConflict(error)) {
      // The verification was canceled (the eleventh challenge, C57.2) or moved on.
      await onSubmitted();
    }
    if (!aborted()) {
      setProblem({ kind: 'request', error });
    }
  };

  /** The submit's own refusal of the challenge (expired, used, superseded) asks for a new one. */
  const submitRefused = async (error: unknown, aborted: () => boolean) => {
    if (problemCode(error) === 'crypto_challenge_invalid') {
      setChallenge(null);
      setProblem({ kind: 'message', key: 'errors.challengeInvalid' });
      return;
    }
    await refused(error, aborted);
  };

  const signWithWallet = async (wallet: BrowserWallet) => {
    const { signal, aborted } = nextRequest();
    setBusy('connecting');
    setProblem(null);
    // Only the submit's refusal of the challenge asks for a new message. The challenge's own 409
    // is the eleventh, which canceled the attempt (C57.2), so the session is read again.
    let submitting = false;
    try {
      const accounts = await walletRequest(wallet.provider, { method: 'eth_requestAccounts' });
      const account: unknown = Array.isArray(accounts) ? accounts[0] : undefined;
      if (typeof account !== 'string' || !EVM_ADDRESS.test(account)) {
        throw new WalletRequestError(false);
      }
      const id = await ensureVerification(client, 'crypto-wallet', progress.current, signal);
      const issued = await client.createCryptoChallenge(
        id,
        { 'chain-id': chain, 'wallet-address': account },
        signal,
      );
      if (aborted()) {
        return;
      }
      setBusy('signing');
      const signed = await walletRequest(wallet.provider, {
        method: 'personal_sign',
        params: [utf8Hex(issued.message), account],
      });
      if (typeof signed !== 'string' || signed === '' || signed.length > SIGNATURE_MAX_LENGTH) {
        throw new WalletRequestError(false);
      }
      if (aborted()) {
        return;
      }
      setBusy('submitting');
      submitting = true;
      await client.submitVerification(id, signal, {
        crypto: { 'challenge-id': issued.id, signature: signed, scheme: 'eip191' },
      });
    } catch (error: unknown) {
      if (aborted()) {
        return;
      }
      setBusy(null);
      if (error instanceof WalletRequestError) {
        const failed = pasteAllowed ? 'wallet.failed' : 'wallet.failedNoPaste';
        setProblem({ kind: 'message', key: error.declined ? 'wallet.declined' : failed });
        return;
      }
      await (submitting ? submitRefused : refused)(error, aborted);
      return;
    }
    await onSubmitted();
  };

  const getMessage = async () => {
    const value = address.trim();
    if (value === '') {
      showAddressError('addressRequired');
      return;
    }
    if (value.length > ADDRESS_MAX_LENGTH || /\s/u.test(value)) {
      showAddressError('addressInvalid');
      return;
    }
    const { signal, aborted } = nextRequest();
    setBusy('gettingMessage');
    setProblem(null);
    setAddressError(null);
    try {
      const id = await ensureVerification(client, 'crypto-wallet', progress.current, signal);
      const issued = await client.createCryptoChallenge(
        id,
        { 'chain-id': chain, 'wallet-address': value },
        signal,
      );
      setChallenge(issued);
      setCopy(null);
      setSignature('');
      setSignedMessage('');
      setSignatureError(null);
    } catch (error: unknown) {
      if (!aborted()) {
        await refused(error, aborted);
      }
    } finally {
      if (!aborted()) {
        setBusy(null);
      }
    }
  };

  const submitPasted = async (issued: FlowCryptoChallengeResponse) => {
    const value = signature.trim();
    if (value === '') {
      showSignatureError('signatureRequired');
      return;
    }
    if (value.length > SIGNATURE_MAX_LENGTH) {
      showSignatureError('signatureTooLong');
      return;
    }
    const wrapped = signedMessage.trim();
    const id = progress.current.verificationId ?? '';
    const { signal, aborted } = nextRequest();
    setBusy('submitting');
    setProblem(null);
    setSignatureError(null);
    try {
      await client.submitVerification(id, signal, {
        crypto: {
          'challenge-id': issued.id,
          signature: value,
          // C57.3: the bytes a Solana wallet wrapped and signed, when the user has them.
          ...(isSolanaChain(chain) && wrapped !== '' ? { 'signed-message': wrapped } : {}),
        },
      });
    } catch (error: unknown) {
      if (!aborted()) {
        setBusy(null);
        await submitRefused(error, aborted);
      }
      return;
    }
    await onSubmitted();
  };

  const copyMessage = async (message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      setCopy('copied');
    } catch {
      // No clipboard (an insecure page, a refused permission): the user selects it instead.
      setCopy('copyFailed');
    }
  };

  const problemText =
    problem === null
      ? null
      : problem.kind === 'message'
        ? t(`cryptoWallet.${problem.key}`)
        : t(entryErrorMessageKey(problem.error));
  const status = busy === null ? null : t(BUSY_KEYS[busy]);
  const expiry =
    challenge === null
      ? ''
      : new Intl.DateTimeFormat(intlTag, {
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(challenge['expires-at']));
  const busyAttribute = busy === null ? undefined : true;

  return (
    <Card ref={card} title={t('cryptoWallet.title')} headingLevel={1}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p>{t('cryptoWallet.intro')}</p>
          <p className="text-sm font-medium text-ink-muted">
            {t('attempt', { current: attempt, max: maxAttempts })}
          </p>
        </div>
        {restarted === true && <Alert tone="warning">{t('cryptoWallet.restarted')}</Alert>}
        <RetryHints hints={hints} photos={false} />

        {step.chains.length > 1 ? (
          <fieldset role="radiogroup" aria-labelledby={networkId} className="flex flex-col gap-2">
            <legend id={networkId} className="text-sm font-medium text-ink">
              {t('cryptoWallet.network')}
            </legend>
            {step.chains.map((chainId) => (
              <label key={chainId} className="flex min-h-11 items-center gap-3 text-sm text-ink">
                <input
                  type="radio"
                  name={networkId}
                  value={chainId}
                  checked={chain === chainId}
                  className="size-5 accent-primary"
                  onChange={() => {
                    setChain(chainId);
                    setChallenge(null);
                    setProblem(null);
                  }}
                />
                {chainLabel(t, chainId)}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="font-medium">
            {tb('cryptoWallet.networkIs', { network: chainLabel(t, chain) })}
          </p>
        )}

        {mode === 'none' && <Alert tone="warning">{t('cryptoWallet.wallet.needed')}</Alert>}

        {mode === 'wallet' && (
          <div className="flex flex-col gap-3">
            {wallets.map((wallet) => (
              <Button
                key={wallet.id}
                className="aria-disabled:cursor-progress"
                aria-disabled={busyAttribute}
                onClick={() => {
                  if (busy === null) {
                    void signWithWallet(wallet);
                  }
                }}
              >
                {wallet.name === null
                  ? t('cryptoWallet.wallet.connect')
                  : tb('cryptoWallet.wallet.connectNamed', { name: wallet.name })}
              </Button>
            ))}
            {pasteAllowed && (
              <Button
                variant="secondary"
                onClick={() => {
                  setPreferPaste(true);
                  setProblem(null);
                }}
              >
                {t('cryptoWallet.wallet.pasteInstead')}
              </Button>
            )}
          </div>
        )}

        {mode === 'paste' && challenge === null && (
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy === null) {
                void getMessage();
              }
            }}
          >
            <Field
              label={t('cryptoWallet.paste.address')}
              description={t('cryptoWallet.paste.addressHint')}
              error={addressError === null ? undefined : t(`cryptoWallet.errors.${addressError}`)}
            >
              <Input
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                }}
              />
            </Field>
            <Button
              type="submit"
              className="aria-disabled:cursor-progress sm:self-end"
              aria-disabled={busyAttribute}
            >
              {t('cryptoWallet.paste.getMessage')}
            </Button>
            {walletUsable && (
              <Button
                variant="secondary"
                className="sm:self-start"
                onClick={() => {
                  setPreferPaste(false);
                  setProblem(null);
                }}
              >
                {t('cryptoWallet.paste.walletInstead')}
              </Button>
            )}
          </form>
        )}

        {mode === 'paste' && challenge !== null && (
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy === null) {
                void submitPasted(challenge);
              }
            }}
          >
            <TextAreaField
              label={t('cryptoWallet.paste.message')}
              description={t('cryptoWallet.paste.messageHint', { time: expiry })}
              readOnly
              rows={8}
              value={challenge.message}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                variant="secondary"
                onClick={() => {
                  void copyMessage(challenge.message);
                }}
              >
                {t('cryptoWallet.paste.copy')}
              </Button>
              <p role="status" className="text-sm">
                {copy === null ? '' : t(`cryptoWallet.paste.${copy}`)}
              </p>
            </div>
            <TextAreaField
              label={t('cryptoWallet.paste.signature')}
              error={
                signatureError === null ? undefined : t(`cryptoWallet.errors.${signatureError}`)
              }
              autoComplete="off"
              spellCheck={false}
              value={signature}
              onChange={(event) => {
                setSignature(event.target.value);
              }}
            />
            {isSolanaChain(chain) && (
              <TextAreaField
                label={t('cryptoWallet.paste.signedMessage')}
                description={t('cryptoWallet.paste.signedMessageHint')}
                autoComplete="off"
                spellCheck={false}
                value={signedMessage}
                onChange={(event) => {
                  setSignedMessage(event.target.value);
                }}
              />
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button
                variant="secondary"
                onClick={() => {
                  setChallenge(null);
                  setProblem(null);
                }}
              >
                {t('cryptoWallet.paste.otherAddress')}
              </Button>
              <Button
                type="submit"
                className="aria-disabled:cursor-progress"
                aria-disabled={busyAttribute}
              >
                {t('cryptoWallet.paste.submit')}
              </Button>
            </div>
          </form>
        )}

        {problemText !== null && <Alert tone="error">{problemText}</Alert>}
        {status !== null && <p role="status">{status}</p>}
      </div>
    </Card>
  );
}

const BUSY_KEYS = {
  connecting: 'cryptoWallet.wallet.connecting',
  signing: 'cryptoWallet.wallet.signing',
  submitting: 'cryptoWallet.wallet.submitting',
  gettingMessage: 'cryptoWallet.paste.gettingMessage',
} as const;
