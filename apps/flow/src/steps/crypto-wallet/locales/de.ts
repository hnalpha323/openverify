import type { Widen } from '../../../i18n/locales/en';
import type { cryptoWalletEn } from './en';

/**
 * German messages of the crypto wallet step (C57, C64.1). Machine-drafted by the build agents
 * (C161.5). Network names are names and stay as written.
 */
export const cryptoWalletDe: Widen<typeof cryptoWalletEn> = {
  title: 'Weisen Sie nach, dass Sie Ihre Krypto-Wallet kontrollieren',
  intro:
    'Sie signieren eine Nachricht mit Ihrer Wallet. Das Signieren ist kostenlos: Es sendet keine Transaktion und bewegt kein Guthaben.',
  network: 'Netzwerk',
  networkIs: 'Netzwerk: {{network}}',
  restarted:
    'Ihr letzter Versuch wurde beendet, weil zu viele Nachrichten zum Signieren angefordert wurden. Beginnen Sie von vorn.',
  wallet: {
    connect: 'Wallet verbinden',
    connectNamed: '{{name}} verbinden',
    connecting: 'Warten auf Ihre Wallet…',
    signing:
      'Signieren Sie die Nachricht in Ihrer Wallet. Sie zeigt diese Website und den Grund der Anfrage.',
    submitting: 'Ihre Signatur wird gesendet…',
    pasteInstead: 'Stattdessen eine Signatur einfügen',
    declined:
      'Sie haben die Anfrage in Ihrer Wallet abgelehnt. Versuchen Sie es erneut, wenn Sie bereit sind.',
    failed:
      'Ihre Wallet konnte die Anfrage nicht abschließen. Versuchen Sie es erneut, oder fügen Sie stattdessen eine Signatur ein.',
    failedNoPaste: 'Ihre Wallet konnte die Anfrage nicht abschließen. Versuchen Sie es erneut.',
    needed:
      'Für diesen Schritt ist eine Browser-Wallet nötig. Öffnen Sie diese Seite in einem Browser mit Wallet-Erweiterung oder im Browser Ihrer Wallet-App.',
  },
  paste: {
    address: 'Wallet-Adresse',
    addressHint: 'Kopieren Sie sie aus Ihrer Wallet und fügen Sie sie hier ein.',
    getMessage: 'Nachricht zum Signieren abrufen',
    gettingMessage: 'Die Nachricht wird abgerufen…',
    message: 'Zu signierende Nachricht',
    messageHint:
      'Signieren Sie genau diese Nachricht in Ihrer Wallet und fügen Sie die Signatur unten ein. Signieren Sie sie vor {{time}}.',
    copy: 'Nachricht kopieren',
    copied: 'Nachricht kopiert.',
    copyFailed: 'Wir konnten die Nachricht nicht kopieren. Markieren und kopieren Sie sie selbst.',
    signature: 'Signatur',
    signedMessage: 'Signierte Nachricht (optional)',
    signedMessageHint:
      'Manche Solana-Wallets zeigen die signierten Bytes an. Wenn Ihre das tut, fügen Sie sie hier ein.',
    submit: 'Signatur senden',
    submitting: 'Ihre Signatur wird gesendet…',
    otherAddress: 'Andere Adresse verwenden',
    walletInstead: 'Stattdessen Ihre Browser-Wallet verwenden',
  },
  errors: {
    addressRequired: 'Geben Sie Ihre Wallet-Adresse ein.',
    addressInvalid:
      'Diese Wallet-Adresse ist für das gewählte Netzwerk nicht gültig. Prüfen Sie, ob Sie die ganze Adresse kopiert haben.',
    addressNotExpected:
      'Das ist nicht die Wallet-Adresse, die Sie verifizieren sollen. Verwenden Sie die erwartete Wallet-Adresse.',
    chainNotOffered: 'Dieses Netzwerk wird hier nicht akzeptiert. Wählen Sie ein anderes Netzwerk.',
    signatureRequired: 'Fügen Sie die Signatur aus Ihrer Wallet ein.',
    signatureTooLong: 'Diese Signatur ist zu lang. Fügen Sie nur die Signatur ein.',
    challengeInvalid:
      'Diese Nachricht ist abgelaufen oder wurde schon verwendet. Rufen Sie eine neue Nachricht zum Signieren ab.',
  },
  chains: {
    bitcoin: 'Bitcoin',
    bitcoinTestnet: 'Bitcoin (Testnetz)',
    litecoin: 'Litecoin',
    dogecoin: 'Dogecoin',
    solana: 'Solana',
    tron: 'TRON',
    xrpl: 'XRP Ledger',
    ethereum: 'Ethereum',
    optimism: 'OP Mainnet',
    bnb: 'BNB Smart Chain',
    polygon: 'Polygon',
    base: 'Base',
    arbitrum: 'Arbitrum One',
    sepolia: 'Sepolia (Testnetz)',
    evm: 'EVM-Netzwerk {{number}}',
  },
};
