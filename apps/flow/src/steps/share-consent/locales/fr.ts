import type { Widen } from '../../../i18n/locales/en';
import type { shareConsentEn } from './en';

/**
 * French messages of the share-consent step (C238.6, C237.6). Machine-drafted by the build agents
 * (C161.5): the `consent` texts are legal texts, drafted and not reviewed, and pending counsel's
 * review in English (C238.10). Placeholders keep their `{{name}}` syntax; the server fills them.
 */
export const shareConsentFr: Widen<typeof shareConsentEn> = {
  consent: {
    title: 'Partager vos informations vérifiées avec {{recipient}}',
    source:
      '{{source}} vous demande votre accord pour partager avec {{recipient}} les informations qu’elle a vérifiées à votre sujet, afin que {{recipient}} puisse réutiliser cette vérification au lieu de vous demander de vous vérifier à nouveau.\n\nCe qui est partagé : {{categories}}. Rien n’est partagé sans votre accord, et refuser le partage n’arrête pas votre vérification.\n\nVotre accord couvre un seul partage avec {{recipient}}, pour cette seule finalité. Il prend fin après {{expires}} si les informations n’ont pas été partagées d’ici là.\n\nPour retirer votre accord, {{withdraw}}. Le retrait arrête tout partage qui n’a pas encore eu lieu. Les informations déjà partagées sont conservées par {{recipient}} selon sa propre politique de confidentialité.',
    destination:
      '{{recipient}} vous demande votre accord pour recevoir les informations que {{source}} a vérifiées à votre sujet, afin que vous n’ayez pas à vous vérifier à nouveau.\n\nCe que {{recipient}} reçoit : {{categories}}. {{recipient}} les utilise uniquement pour vérifier votre identité pour cette demande et les conserve pendant {{retention}}. Rien n’est reçu sans votre accord, et refuser le partage n’arrête pas votre vérification : vous vous vérifiez ici.\n\nVotre accord prend fin après {{expires}} si les informations n’ont pas été reçues d’ici là.\n\nPour retirer votre accord, {{withdraw}}. Le retrait arrête tout transfert qui n’a pas encore eu lieu.',
    'biometric-source':
      'J’accepte que {{source}} partage mes données biométriques avec {{recipient}} : la photo de mon visage sur ma pièce d’identité, mon selfie et les résultats de leur comparaison.',
    'biometric-destination':
      'J’accepte que {{recipient}} reçoive mes données biométriques de {{source}} : la photo de mon visage sur ma pièce d’identité, mon selfie et les résultats de leur comparaison. {{recipient}} les conserve pendant {{retention}}, uniquement pour vérifier mon identité.',
    accept: 'J’accepte',
    decline: 'Ne pas partager',
    withdraw: 'Retirer mon accord de partage avec {{recipient}}',
  },
  step: {
    sharedBy: 'Partagé par',
    sharedWith: 'Partagé avec',
    whatIsShared: 'Ce qui est partagé',
    saving: 'Enregistrement de votre choix…',
    biometricRequired:
      'Cochez la case pour accepter de partager vos données biométriques, ou choisissez de ne pas partager.',
    withdrawHeading: 'Votre accord de partage',
    withdrawIntro:
      'Vous avez accepté de partager vos informations vérifiées avec {{recipient}}. Vous pouvez retirer cet accord tant que cette vérification est ouverte.',
    withdrawing: 'Retrait de votre accord…',
    withdrawn: 'Vous avez retiré votre accord de partage avec {{recipient}}.',
  },
  categories: {
    'identity-fields': 'vos informations d’identité, comme votre nom et votre date de naissance',
    'contact-fields': 'vos coordonnées, comme votre adresse e-mail et votre numéro de téléphone',
    'other-fields': 'd’autres informations que vous avez saisies',
    'document-images': 'des images de vos pièces d’identité',
    biometric:
      'des données biométriques : des photos de votre visage et les résultats de leur comparaison',
    'check-results': 'les résultats des vérifications de vos informations',
  },
};
