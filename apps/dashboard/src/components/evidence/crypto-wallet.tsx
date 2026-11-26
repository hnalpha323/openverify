/**
 * C66: the `verification/crypto-wallet` evidence, owned by `dashboard-people` (Workflow 5C): the
 * claimed and expected addresses exactly as the API sent them to this operator ("Hidden" without
 * `pii:view`, "Redacted" after a redaction, C53.7), the chain and the signature scheme in words
 * with their codes, the address type and checksum, the flags the checks raised (high-s, a loose
 * BIP-137 header, a contract wallet, the ed25519 curve, an unwrapped Solana envelope, C57.4) in
 * words, the EVM RPC asked about a contract wallet (labelled when it is the sandbox one, ADR 0002
 * §3d), and what a pass means (`docs/checks/crypto-wallet.md`). A server component that reads
 * only the verification answer.
 */
import { cryptoWalletEvidenceOf, type CryptoFlag } from '../../lib/crypto-wallet-evidence';
import {
  CRYPTO_WALLET_PASS_MEANS,
  SANDBOX_RPC_TEXT,
  addressTypeText,
  checksumText,
  cryptoChainText,
  cryptoFlagText,
  signatureSchemeText,
} from '../../lib/crypto-wallet-words';
import { Detail } from '../detail';
import { EmptyValue } from '../masked-value';
import { GenericEvidence, type EvidenceProps } from './generic';
import { Code, NotRecorded, PassMeans, PersonalValue, Words } from './parts';

/** A value in words with its code beneath; one without words as its code alone. */
function Named({ words, code }: { readonly words: string | undefined; readonly code: string }) {
  if (words === undefined || words === code) {
    return <Code>{code}</Code>;
  }
  return (
    <span className="flex flex-col">
      <span>{words}</span>
      <Code>{code}</Code>
    </span>
  );
}

/**
 * The flags raised, in words: a recorded `false` raises none (a low-s signature), and a value the
 * console has no words for shows as its code.
 */
function Flags({ flags, ran }: { readonly flags: readonly CryptoFlag[]; readonly ran: boolean }) {
  const raised = flags.flatMap((entry) => {
    const text = cryptoFlagText(entry.flag, entry.value);
    return text === undefined && entry.value === false ? [] : [{ ...entry, text }];
  });
  if (raised.length === 0) {
    return ran ? <span className="text-ink-muted">None raised</span> : <NotRecorded ran={false} />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {raised.map(({ flag, value, text }) => (
        <li key={flag} className="flex flex-col">
          {text === undefined ? (
            <Code>{`${flag}: ${String(value)}`}</Code>
          ) : (
            <>
              <span>{text.words}</span>
              {text.explanation !== undefined && (
                <span className="text-xs text-ink-muted">{text.explanation}</span>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CryptoWalletEvidence({ verification, label, state }: EvidenceProps) {
  if (verification.type !== 'verification/crypto-wallet') {
    return <GenericEvidence verification={verification} label={label} state={state} />;
  }
  const evidence = cryptoWalletEvidenceOf(verification);
  const ran = verification.attributes.checks.length > 0;
  const { chainId, scheme, addressType, checksum } = evidence;
  return (
    <div role="group" aria-label={`${label} evidence`} className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Detail term="Wallet address">
          <PersonalValue value={evidence.walletAddress} state={state} />
        </Detail>
        <Detail term="Expected address">
          <PersonalValue value={evidence.expectedAddress} state={state} />
        </Detail>
        <Detail term="Chain">
          {chainId === null ? (
            <EmptyValue />
          ) : (
            <Named words={cryptoChainText(chainId)} code={chainId} />
          )}
        </Detail>
        <Detail term="Signature scheme">
          {scheme === null ? (
            <NotRecorded ran={ran} />
          ) : (
            <Named words={signatureSchemeText(scheme)} code={scheme} />
          )}
        </Detail>
        <Detail term="Address type">
          {addressType === null ? (
            <NotRecorded ran={ran} />
          ) : (
            (addressTypeText(addressType) ?? <Code>{addressType}</Code>)
          )}
        </Detail>
        <Detail term="Checksum">
          {checksum === null ? (
            <NotRecorded ran={ran} />
          ) : (
            <Words text={checksumText(checksum)} code={checksum} />
          )}
        </Detail>
        <Detail term="Flags">
          <Flags flags={evidence.flags} ran={ran} />
        </Detail>
        {evidence.rpc !== null && (
          <Detail term="Contract checked by">
            <span className="flex flex-col">
              <Code>{evidence.rpc.id}</Code>
              {/* ADR 0002 §3d: a sandbox provider is labelled as one. */}
              {evidence.rpc.sandbox && (
                <span className="text-xs text-ink-muted">{SANDBOX_RPC_TEXT}</span>
              )}
            </span>
          </Detail>
        )}
      </dl>
      <PassMeans text={CRYPTO_WALLET_PASS_MEANS} />
    </div>
  );
}
