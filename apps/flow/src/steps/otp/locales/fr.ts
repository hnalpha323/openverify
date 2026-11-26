import type { Widen } from '../../../i18n/locales/en';
import type { otpEn } from './en';

/**
 * French messages of the phone and email one-time-code steps (C55, C64.1). Machine-drafted by the
 * build agents (C161.5): the person is addressed as « vous », with no gendered agreement.
 */
export const otpFr: Widen<typeof otpEn> = {
  send: 'Envoyer le code',
  sending: 'Envoi de votre code…',
  phone: {
    title: 'Confirmez votre numéro de téléphone',
    intro:
      'Nous allons envoyer un code par SMS à votre téléphone. Les tarifs habituels de vos messages peuvent s’appliquer.',
    country: 'Pays',
    countryOption: '{{country}} ({{code}})',
    number: 'Numéro de téléphone',
    numberHint: 'Vous pouvez omettre l’indicatif du pays.',
    change: 'Changer de numéro de téléphone',
    errors: {
      required: 'Saisissez votre numéro de téléphone.',
      invalid: 'Saisissez un numéro de téléphone valide pour le pays choisi.',
      notAllowed:
        'Aucun code ne peut être envoyé à ce numéro ici. Utilisez un numéro de l’un des pays proposés.',
      destinationInvalid:
        'Ce numéro ne peut pas recevoir de code. Vérifiez-le ou utilisez un autre numéro de téléphone.',
      deliveryFailed:
        'Nous n’avons pas pu envoyer de code à ce numéro. Vérifiez-le et réessayez, ou utilisez un autre numéro.',
    },
  },
  email: {
    title: 'Confirmez votre adresse e-mail',
    intro: 'Nous allons envoyer un code à votre adresse e-mail.',
    address: 'Adresse e-mail',
    change: 'Changer d’adresse e-mail',
    errors: {
      required: 'Saisissez votre adresse e-mail.',
      invalid: 'Saisissez une adresse e-mail au bon format, par exemple name@example.com.',
      notAllowed:
        'Aucun code ne peut être envoyé à cette adresse e-mail ici. Utilisez une autre adresse e-mail.',
      destinationInvalid:
        'Cette adresse e-mail ne peut pas recevoir de code. Vérifiez-la ou utilisez une autre adresse e-mail.',
      deliveryFailed:
        'Nous n’avons pas pu envoyer de code à cette adresse e-mail. Vérifiez-la et réessayez, ou utilisez une autre adresse e-mail.',
    },
  },
  code: {
    title: 'Saisissez le code',
    sentTo: 'Nous avons envoyé un code à {{destination}}.',
    sentAgain: 'Nous avons envoyé un nouveau code à {{destination}}.',
    label: 'Code',
    hint: 'Le code comporte {{length}} chiffres.',
    confirm: 'Confirmer',
    checking: 'Vérification de votre code…',
    attemptsLeft: 'Essais restants pour ce code : {{remaining}}',
    expiresAt: 'Le code expire à {{time}}.',
    resend: 'Envoyer un nouveau code',
    resendIn: 'Vous pourrez demander un nouveau code dans {{time}}.',
    resendReady: 'Vous pouvez maintenant demander un nouveau code.',
    noResend: 'Aucun autre code ne peut être envoyé.',
    expiredFinal:
      'Ce code a expiré et aucun autre code ne peut être envoyé. Recommencez pour obtenir un nouveau code.',
    startAgain: 'Recommencer',
    errors: {
      required: 'Saisissez le code que nous vous avons envoyé.',
      format: 'Saisissez le code à {{length}} chiffres.',
      incorrect: 'Ce code n’est pas correct. Vérifiez-le et réessayez.',
      expired: 'Ce code a expiré. Demandez un nouveau code.',
      exhausted: 'Trop d’essais incorrects pour ce code. Demandez un nouveau code.',
      notSent: 'Demandez d’abord un code.',
      tooSoon: 'Patientez un peu avant de demander un nouveau code.',
    },
  },
  limited: {
    title: 'Nous ne pouvons pas vous envoyer de code pour le moment',
    message:
      'Nous n’avons pas pu vous envoyer ni vérifier de code pour le moment. Vous pouvez continuer : l’organisation qui vous a demandé de vous vérifier examinera votre vérification.',
    continue: 'Continuer',
    continuing: 'Envoi de votre vérification…',
    failed: 'Nous n’avons pas pu continuer. Patientez un moment, puis réessayez.',
  },
  confirmed: {
    title: 'Votre code a été confirmé',
    submitting: 'Envoi de votre vérification…',
  },
};
