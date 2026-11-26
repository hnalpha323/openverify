import type { Widen } from '../../../i18n/locales/en';
import type { nfcEn } from './en';

/** German messages of the `nfc` step in a browser (C207.10). Machine-drafted (C161.5). */
export const nfcDe: Widen<typeof nfcEn> = {
  title: 'Für diesen Schritt wird die App der Organisation benötigt',
  needsApp:
    'Zum Auslesen des Chips eines Dokuments wird die App der Organisation benötigt; ein Browser kann ihn nicht auslesen.',
  otherWay: 'Sie können hier auf anderem Weg fortfahren.',
  useAnotherWay: 'Anderen Weg nutzen',
  switching: 'Wechsel zu einem anderen Weg…',
  noOtherWay:
    'Fahren Sie in der App der Organisation fort. Wenn Sie die App nicht haben, wenden Sie sich an die Organisation, die Sie um die Verifizierung gebeten hat.',
};
