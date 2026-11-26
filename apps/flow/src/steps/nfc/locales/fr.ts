import type { Widen } from '../../../i18n/locales/en';
import type { nfcEn } from './en';

/** French messages of the `nfc` step in a browser (C207.10). Machine-drafted (C161.5). */
export const nfcFr: Widen<typeof nfcEn> = {
  title: 'Cette étape nécessite l’application de l’organisation',
  needsApp:
    'La lecture de la puce d’un document nécessite l’application de l’organisation ; un navigateur ne peut pas la lire.',
  otherWay: 'Vous pouvez continuer ici d’une autre manière.',
  useAnotherWay: 'Utiliser une autre manière',
  switching: 'Passage à une autre manière…',
  noOtherWay:
    'Continuez dans l’application de l’organisation. Si vous ne l’avez pas, contactez l’organisation qui vous a demandé de vous vérifier.',
};
