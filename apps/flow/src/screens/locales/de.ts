import type { Widen } from '../../i18n/locales/en';
import type { screenEn } from './en';

/**
 * German messages of the screen step and the server-position screens (C148.7, C150.5, C151.2,
 * C158.5, C171.4). Machine-drafted by the build agents (C161.5): the person is addressed as „Sie“.
 */
export const screenDe: Widen<typeof screenEn> = {
  continue: 'Weiter',
  heading: 'Ihre Angaben',
  required: 'Mit * markierte Felder sind Pflichtfelder.',
  choose: 'Bitte wählen…',
  set: 'Bereits angegeben. Geben Sie einen neuen Wert ein, um ihn zu ändern.',
  summary: 'Bitte prüfen Sie diese Angaben:',
  errors: {
    required: 'Geben Sie einen Wert ein oder wählen Sie einen aus.',
    tooShort: 'Geben Sie mindestens {{limit}} Zeichen ein.',
    tooLong: 'Geben Sie höchstens {{limit}} Zeichen ein.',
    pattern: 'Das entspricht nicht dem erwarteten Format.',
    number: 'Geben Sie eine Zahl ein.',
    tooSmall: 'Geben Sie {{limit}} oder mehr ein.',
    tooLarge: 'Geben Sie {{limit}} oder weniger ein.',
    date: 'Geben Sie ein Datum ein.',
    dateTooEarly: 'Geben Sie den {{limit}} oder ein späteres Datum ein.',
    dateTooLate: 'Geben Sie den {{limit}} oder ein früheres Datum ein.',
    email: 'Geben Sie eine E-Mail-Adresse ein, zum Beispiel name@example.com.',
    phone: 'Geben Sie eine Telefonnummer mit Ländervorwahl ein.',
    url: 'Geben Sie eine Webadresse ein, die mit https:// beginnt.',
    option: 'Wählen Sie eine der Optionen.',
    country: 'Wählen Sie eines der Länder.',
    refused: 'Dieser Wert wurde nicht angenommen. Prüfen Sie ihn und versuchen Sie es erneut.',
  },
  address: {
    street1: 'Straße und Hausnummer',
    street2: 'Wohnung, Gebäude oder Etage (optional)',
    city: 'Ort',
    subdivision: 'Bundesland, Provinz oder Region',
    postalCode: 'Postleitzahl',
    country: 'Land',
  },
  saving: 'Ihre Angaben werden gespeichert…',
  cancel: {
    title: 'Vorerst aufhören?',
    message:
      'Ihre bisherigen Angaben bleiben erhalten. Mit demselben Link können Sie später weitermachen.',
    confirm: 'Ja, vorerst aufhören',
    keep: 'Nein, weitermachen',
    stopped: 'Sie haben vorerst aufgehört',
    stoppedMessage: 'Mit demselben Link können Sie dort weitermachen, wo Sie aufgehört haben.',
  },
  unavailable: 'Dieser Bildschirm kann in dieser Version nicht angezeigt werden.',
  help: 'Hilfe und Datenschutz',
  helpLink: 'Hilfe erhalten',
  privacyLink: 'Datenschutzhinweis',
  waiting: {
    title: 'Einen Moment',
    message: 'Der nächste Schritt wird vorbereitet…',
  },
  halted: {
    title: 'Diese Verifizierung kann nicht fortgesetzt werden',
    message:
      'Etwas hat diese Verifizierung angehalten. Wenden Sie sich an die Organisation, die Sie um die Verifizierung gebeten hat.',
  },
  redirect: {
    announce:
      'Ihr Teil ist erledigt. Mit „Weiter“ kehren Sie zu der Website zurück, von der Sie gekommen sind.',
    continue: 'Weiter',
  },
  extend: {
    warning: 'Noch etwa {{seconds}} Sekunden für Ihre Fotos. Brauchen Sie mehr Zeit?',
    button: 'Mehr Zeit',
    extended: 'Sie haben mehr Zeit.',
    failed:
      'Wir konnten keine Zeit hinzufügen. Machen Sie Ihre Fotos jetzt, oder beginnen Sie neu, wenn die Zeit abläuft.',
  },
};
