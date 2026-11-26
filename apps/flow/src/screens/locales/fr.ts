import type { Widen } from '../../i18n/locales/en';
import type { screenEn } from './en';

/**
 * French messages of the screen step and the server-position screens (C148.7, C150.5, C151.2,
 * C158.5, C171.4). Machine-drafted by the build agents (C161.5): the person is addressed as
 * « vous », with no gendered agreement.
 */
export const screenFr: Widen<typeof screenEn> = {
  continue: 'Continuer',
  heading: 'Vos informations',
  required: 'Les champs marqués d’un * sont obligatoires.',
  choose: 'Choisissez…',
  set: 'Déjà fourni. Saisissez une nouvelle valeur pour le modifier.',
  summary: 'Vérifiez ces réponses :',
  errors: {
    required: 'Saisissez ou choisissez une valeur.',
    tooShort: 'Saisissez au moins {{limit}} caractères.',
    tooLong: 'Saisissez au plus {{limit}} caractères.',
    pattern: 'Ce n’est pas au format attendu.',
    number: 'Saisissez un nombre.',
    tooSmall: 'Saisissez {{limit}} ou plus.',
    tooLarge: 'Saisissez {{limit}} ou moins.',
    date: 'Saisissez une date.',
    dateTooEarly: 'Saisissez le {{limit}} ou une date ultérieure.',
    dateTooLate: 'Saisissez le {{limit}} ou une date antérieure.',
    email: 'Saisissez une adresse e-mail, par exemple nom@example.com.',
    phone: 'Saisissez un numéro de téléphone avec son indicatif de pays.',
    url: 'Saisissez une adresse web qui commence par https://.',
    option: 'Choisissez l’une des options.',
    country: 'Choisissez l’un des pays.',
    refused: 'Cette valeur n’a pas été acceptée. Vérifiez-la et réessayez.',
  },
  address: {
    street1: 'Adresse',
    street2: 'Appartement, bâtiment ou étage (facultatif)',
    city: 'Ville',
    subdivision: 'État, province ou région',
    postalCode: 'Code postal',
    country: 'Pays',
  },
  saving: 'Enregistrement de vos réponses…',
  cancel: {
    title: 'Vous arrêter pour le moment ?',
    message: 'Vos réponses sont conservées. Vous pouvez revenir avec le même lien pour continuer.',
    confirm: 'Oui, m’arrêter pour le moment',
    keep: 'Non, continuer',
    stopped: 'Vérification interrompue pour le moment',
    stoppedMessage: 'Vous pouvez revenir avec le même lien pour reprendre là où vous en étiez.',
  },
  unavailable: 'Cet écran ne peut pas être affiché dans cette version.',
  help: 'Aide et confidentialité',
  helpLink: 'Obtenir de l’aide',
  privacyLink: 'Avis de confidentialité',
  waiting: {
    title: 'Un instant',
    message: 'Nous préparons l’étape suivante…',
  },
  halted: {
    title: 'Cette vérification ne peut pas continuer',
    message:
      'Un problème empêche cette vérification de continuer. Contactez l’organisation qui vous a demandé de vous vérifier.',
  },
  redirect: {
    announce:
      'Votre partie est terminée. Utilisez Continuer pour revenir au site web d’où vous venez.',
    continue: 'Continuer',
  },
  extend: {
    warning:
      'Il reste environ {{seconds}} secondes pour prendre vos photos. Besoin de plus de temps ?',
    button: 'Plus de temps',
    extended: 'Vous avez plus de temps.',
    failed:
      'Nous n’avons pas pu ajouter de temps. Prenez vos photos maintenant, ou recommencez si le temps est écoulé.',
  },
};
