import type { Widen } from '../../../i18n/locales/en';
import type { cryptoWalletEn } from './en';

/**
 * French messages of the crypto wallet step (C57, C64.1). Machine-drafted by the build agents
 * (C161.5). Network names are names and stay as written.
 */
export const cryptoWalletFr: Widen<typeof cryptoWalletEn> = {
  title: 'Prouvez que vous contrôlez votre portefeuille crypto',
  intro:
    'Vous signez un message avec votre portefeuille. Signer un message est gratuit : cela n’envoie aucune transaction et ne déplace aucun fonds.',
  network: 'Réseau',
  networkIs: 'Réseau : {{network}}',
  restarted:
    'Votre dernière tentative s’est arrêtée parce que trop de messages à signer ont été demandés. Recommencez.',
  wallet: {
    connect: 'Connecter votre portefeuille',
    connectNamed: 'Connecter {{name}}',
    connecting: 'En attente de votre portefeuille…',
    signing:
      'Signez le message dans votre portefeuille. Il indique ce site web et la raison de la demande.',
    submitting: 'Envoi de votre signature…',
    pasteInstead: 'Coller une signature à la place',
    declined:
      'Vous avez refusé la demande dans votre portefeuille. Réessayez quand vous le souhaitez.',
    failed:
      'Votre portefeuille n’a pas pu traiter la demande. Réessayez, ou collez une signature à la place.',
    failedNoPaste: 'Votre portefeuille n’a pas pu traiter la demande. Réessayez.',
    needed:
      'Cette étape nécessite un portefeuille de navigateur. Ouvrez cette page dans un navigateur doté d’une extension de portefeuille, ou dans le navigateur de l’application de votre portefeuille.',
  },
  paste: {
    address: 'Adresse du portefeuille',
    addressHint: 'Copiez-la depuis votre portefeuille, puis collez-la ici.',
    getMessage: 'Obtenir le message à signer',
    gettingMessage: 'Récupération du message…',
    message: 'Message à signer',
    messageHint:
      'Signez exactement ce message dans votre portefeuille, puis collez la signature ci-dessous. Signez-le avant {{time}}.',
    copy: 'Copier le message',
    copied: 'Message copié.',
    copyFailed: 'Nous n’avons pas pu copier le message. Sélectionnez-le et copiez-le vous-même.',
    signature: 'Signature',
    signedMessage: 'Message signé (facultatif)',
    signedMessageHint:
      'Certains portefeuilles Solana affichent les octets qu’ils ont signés. Si c’est le cas du vôtre, collez-les ici.',
    submit: 'Envoyer la signature',
    submitting: 'Envoi de votre signature…',
    otherAddress: 'Utiliser une autre adresse',
    walletInstead: 'Utiliser plutôt le portefeuille de votre navigateur',
  },
  errors: {
    addressRequired: 'Saisissez l’adresse de votre portefeuille.',
    addressInvalid:
      'Cette adresse de portefeuille n’est pas valide pour le réseau choisi. Vérifiez que vous avez copié l’adresse entière.',
    addressNotExpected:
      'Ce n’est pas l’adresse de portefeuille qu’on vous a demandé de vérifier. Utilisez l’adresse attendue.',
    chainNotOffered: 'Ce réseau n’est pas accepté ici. Choisissez un autre réseau.',
    signatureRequired: 'Collez la signature de votre portefeuille.',
    signatureTooLong: 'Cette signature est trop longue. Collez uniquement la signature.',
    challengeInvalid:
      'Ce message a expiré ou a déjà été utilisé. Obtenez un nouveau message à signer.',
  },
  chains: {
    bitcoin: 'Bitcoin',
    bitcoinTestnet: 'Bitcoin (réseau de test)',
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
    sepolia: 'Sepolia (réseau de test)',
    evm: 'Réseau EVM {{number}}',
  },
};
