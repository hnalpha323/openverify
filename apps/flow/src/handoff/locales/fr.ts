import type { Widen } from '../../i18n/locales/en';
import type { handoffEn } from './en';

/** French messages of device handoff (C96.5). Machine-drafted by the build agents (C161.5). */
export const handoffFr: Widen<typeof handoffEn> = {
  desktop: {
    title: 'Continuez sur votre téléphone',
    intro:
      'Scannez ce code avec l’appareil photo de votre téléphone pour continuer cette vérification sur votre téléphone. Votre progression est conservée.',
    issuing: 'Obtention d’un code pour votre téléphone…',
    qrLabel: 'Code QR qui ouvre cette vérification sur votre téléphone',
    linkLabel: 'Ou ouvrez ce lien sur votre téléphone',
    copy: 'Copier le lien',
    copied: 'Lien copié.',
    expiresIn: 'Ce code expire dans {{time}}.',
    expired: 'Ce code a expiré. Obtenez-en un nouveau pour continuer sur votre téléphone.',
    newCode: 'Obtenir un nouveau code',
    confirmationCode: 'Quand votre téléphone demande un code, saisissez : {{code}}',
    emailOption: 'Envoyer plutôt un lien par e-mail',
    smsOption: 'Envoyer plutôt un lien par SMS',
    emailLabel: 'Adresse e-mail',
    smsLabel: 'Numéro de téléphone, avec l’indicatif du pays',
    smsHint: 'Par exemple +1 202 555 0123.',
    send: 'Envoyer le lien',
    sending: 'Envoi du lien…',
    sentEmail:
      'Nous avons envoyé un lien à votre adresse e-mail. Ouvrez-le sur votre téléphone dans les {{minutes}} minutes.',
    sentSms:
      'Nous avons envoyé un lien par SMS à votre téléphone. Ouvrez-le dans les {{minutes}} minutes.',
    showQr: 'Afficher plutôt un code QR',
    continueHere: 'Continuer sur cet appareil',
    continuing: 'Poursuite sur cet appareil…',
    waitingTitle: 'Poursuite sur votre téléphone',
    waiting:
      'Vous avez continué sur votre téléphone à {{time}}. Terminez la vérification sur celui-ci ; cette page se met à jour une fois que c’est fait.',
    waitingDevice: 'Votre téléphone : {{device}}',
    notMe: 'Ce n’était pas moi',
    rejecting: 'Fermeture de la session sur l’autre appareil…',
    rejected:
      'Nous avons fermé la session sur l’autre appareil et annulé ce qu’il n’avait pas terminé. Obtenez un nouveau code, ou continuez ici.',
    declined: 'L’autre appareil a refusé de continuer. Obtenez un nouveau code, ou continuez ici.',
    errors: {
      destinationNotConfirmed:
        'Un lien ne peut être envoyé qu’à une adresse e-mail ou un numéro de téléphone confirmé plus tôt dans cette vérification.',
      sendLimited: 'Trop de liens ont été envoyés. Patientez un moment, ou utilisez le code QR.',
      required: 'Indiquez où envoyer le lien.',
    },
  },
  phone: {
    title: 'Poursuivez votre vérification',
    loading: 'Vérification de votre lien…',
    requester: '{{organization}} a demandé à vérifier votre identité.',
    verifies: 'Sur ce téléphone, il vous sera demandé :',
    started: 'Cette vérification a commencé sur un autre appareil à {{time}}.',
    startedIn: 'Cette vérification a commencé sur un autre appareil, en {{country}}, à {{time}}.',
    adviceQr:
      'Continuez uniquement si vous venez de scanner ce code sur le site web de {{organization}}. Si quelqu’un vous a envoyé ce code, refusez.',
    adviceLink:
      'Continuez uniquement si vous venez de demander ce lien sur le site web de {{organization}}. Sinon, refusez.',
    codeLabel: 'Code affiché sur votre autre appareil',
    codeHint: 'Six chiffres.',
    codeRequired: 'Saisissez le code à six chiffres affiché sur votre autre appareil.',
    checkCode: 'Vérifier le code',
    checking: 'Vérification du code…',
    continue: 'Continuer',
    continuing: 'Ouverture de votre vérification…',
    decline: 'Refuser',
    declining: 'Refus en cours…',
    declinedTitle: 'Vous avez refusé',
    declined: 'Rien n’a été partagé depuis ce téléphone. Vous pouvez fermer cette page.',
    invalid:
      'Ce lien n’est pas valide, a expiré ou a déjà été utilisé. Revenez à l’appareil sur lequel vous avez commencé pour obtenir un nouveau code.',
    limitTitle: 'Cette vérification ne peut pas continuer ici',
    limit:
      'Cette vérification ne peut pas être poursuivie sur un autre appareil. Revenez à l’appareil sur lequel vous avez commencé.',
  },
  steps: {
    form: 'quelques informations vous concernant',
    government_id: 'une photo de votre pièce d’identité',
    selfie: 'un selfie',
    document: 'le téléversement d’un document',
    phone_otp: 'un code envoyé sur votre téléphone',
    email_otp: 'un code envoyé par e-mail',
    database: 'une vérification de vos informations dans une base de données',
    aamva: 'une vérification des informations de votre permis de conduire auprès de son émetteur',
    nfc: 'la lecture de la puce de votre pièce d’identité',
    crypto_wallet: 'la preuve que vous contrôlez un portefeuille crypto',
    database_business: 'une vérification de votre entreprise dans des registres d’entreprises',
    business_website: 'une vérification du site web de votre entreprise',
  },
};
