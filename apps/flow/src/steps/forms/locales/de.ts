import type { Widen } from '../../../i18n/locales/en';
import type { formsEn } from './en';

/**
 * German messages of the steps the user fills in (C52.3, C64.1). Machine-drafted by the build
 * agents (C161.5). Examples (`name@example.com`, `https://www.example.com`, `YYYY-MM-DD`) are the
 * formats the fields accept and stay as written.
 */
export const formsDe: Widen<typeof formsEn> = {
  requiredNote: 'Mit * markierte Felder sind Pflichtfelder.',
  continue: 'Weiter',
  sending: 'Ihre Angaben werden gesendet…',
  received:
    'Wir haben Ihre Angaben erhalten. Senden Sie sie zur Prüfung, oder ändern Sie sie unten.',
  sendReceived: 'Zur Prüfung senden',
  invalid: 'Prüfen Sie die unten markierten Angaben.',
  refused: 'Einige Angaben wurden nicht akzeptiert. Prüfen Sie sie und versuchen Sie es erneut.',
  address: 'Adresse',
  chooseCountry: 'Land auswählen',
  chooseState: 'Bundesstaat oder Territorium auswählen',
  database: {
    title: 'Geben Sie Ihre Angaben ein',
    intro:
      'Wir gleichen diese Angaben mit amtlichen Registern ab. Geben Sie sie so ein, wie sie in Ihren amtlichen Dokumenten stehen.',
  },
  database_business: {
    title: 'Angaben zu Ihrem Unternehmen',
    intro:
      'Wir suchen diese Angaben in amtlichen Unternehmensregistern. Geben Sie sie so ein, wie das Unternehmen eingetragen ist.',
  },
  business_website: {
    title: 'Geben Sie die Website Ihres Unternehmens ein',
    intro: 'Wir prüfen, ob die Adresse der Website existiert. Die Website selbst öffnen wir nie.',
  },
  businessAddress: 'Eingetragene Adresse',
  persons: {
    legend: 'Personen, denen das Unternehmen gehört oder die es leiten',
    intro:
      'Sie können bis zu {{max}} Personen aus Geschäftsführung, Vorstand oder Eigentümerkreis zur Prüfung im Register hinzufügen.',
    person: 'Person {{number}}',
    add: 'Person hinzufügen',
    remove: 'Person {{number}} entfernen',
    full: 'Sie haben die höchstmögliche Zahl von Personen hinzugefügt.',
  },
  aamva: {
    title: 'Geben Sie die Daten Ihres Führerscheins ein',
    intro:
      'Geben Sie die Daten genau so ein, wie sie auf Ihrem US-Führerschein oder Ihrem bundesstaatlichen Ausweis gedruckt sind. Wir prüfen sie bei der ausstellenden Behörde.',
  },
  silent: {
    title: 'Ihre Führerscheindaten werden geprüft',
    message:
      'Wir prüfen Ihren Führerschein oder Ausweis bei der ausstellenden Behörde. Das dauert meist nur wenige Sekunden. Lassen Sie diese Seite geöffnet.',
  },
  fields: {
    'name-first': 'Vorname',
    'name-middle': 'Zweiter Vorname',
    'name-last': 'Nachname',
    birthdate: 'Geburtsdatum',
    'address-street-1': 'Adresszeile 1',
    'address-street-2': 'Adresszeile 2',
    'address-city': 'Ort',
    'address-subdivision': 'Bundesland, Provinz oder Region',
    'address-postal-code': 'Postleitzahl',
    'address-country-code': 'Land',
    'identification-number': 'Identifikationsnummer',
    'phone-number': 'Telefonnummer',
    'email-address': 'E-Mail-Adresse',
    licenseNumber: 'Nummer des Führerscheins oder Ausweises',
    issuingAuthority: 'Ausstellender Bundesstaat oder ausstellendes Territorium',
    issueDate: 'Ausstellungsdatum',
    expirationDate: 'Ablaufdatum',
    zip: 'ZIP-Code',
    'business-name': 'Name des Unternehmens',
    'country-code': 'Land der Eintragung',
    'registration-number': 'Registernummer',
    lei: 'Rechtsträgerkennung (LEI)',
    businessStreet1: 'Adresszeile 1',
    businessStreet2: 'Adresszeile 2',
    businessCity: 'Ort',
    businessSubdivision: 'Bundesland, Provinz oder Region',
    businessPostalCode: 'Postleitzahl',
    'person-name-first': 'Vorname',
    'person-name-last': 'Nachname',
    'person-birthdate': 'Geburtsmonat oder Geburtsdatum',
    'website-url': 'Adresse der Website',
  },
  hints: {
    'phone-number': 'Geben Sie Ihre Ländervorwahl mit an.',
    registrationGb:
      'Bei einem britischen Unternehmen die 8-stellige Companies-House-Nummer, etwa 01234567 oder SC123456.',
    registrationUs: 'Bei einem US-Unternehmen sein SEC Central Index Key (CIK), bis zu 10 Ziffern.',
    registration:
      'Die Nummer, die das Register dem Unternehmen gibt: bis zu 20 Buchstaben und Ziffern.',
    lei: 'Der 20-stellige Code aus dem weltweiten LEI-Register. Lassen Sie das Feld leer, wenn das Unternehmen keinen hat.',
    'person-birthdate': 'Im Format YYYY-MM oder YYYY-MM-DD.',
    'website-url': 'Mit https:// oder http://, etwa https://www.example.com.',
  },
  required: {
    'name-first': 'Geben Sie Ihren Vornamen ein.',
    'name-middle': 'Geben Sie Ihren zweiten Vornamen ein.',
    'name-last': 'Geben Sie Ihren Nachnamen ein.',
    birthdate: 'Geben Sie Ihr Geburtsdatum ein.',
    'address-street-1': 'Geben Sie die erste Zeile Ihrer Adresse ein.',
    'address-street-2': 'Geben Sie die zweite Zeile Ihrer Adresse ein.',
    'address-city': 'Geben Sie Ihren Ort ein.',
    'address-subdivision': 'Geben Sie Ihr Bundesland, Ihre Provinz oder Ihre Region ein.',
    'address-postal-code': 'Geben Sie Ihre Postleitzahl ein.',
    'address-country-code': 'Wählen Sie Ihr Land aus.',
    'identification-number': 'Geben Sie Ihre Identifikationsnummer ein.',
    'phone-number': 'Geben Sie Ihre Telefonnummer ein.',
    'email-address': 'Geben Sie Ihre E-Mail-Adresse ein.',
    licenseNumber: 'Geben Sie die Nummer Ihres Führerscheins oder Ausweises ein.',
    issuingAuthority:
      'Wählen Sie den Bundesstaat oder das Territorium aus, das ihn ausgestellt hat.',
    issueDate: 'Geben Sie das Ausstellungsdatum ein.',
    expirationDate: 'Geben Sie das Ablaufdatum ein.',
    zip: 'Geben Sie Ihren ZIP-Code ein.',
    'business-name': 'Geben Sie den Namen des Unternehmens ein.',
    'country-code': 'Wählen Sie das Land aus, in dem das Unternehmen eingetragen ist.',
    'registration-number': 'Geben Sie die Registernummer ein.',
    lei: 'Geben Sie die LEI ein.',
    businessStreet1: 'Geben Sie die erste Zeile der Unternehmensadresse ein.',
    businessStreet2: 'Geben Sie die zweite Zeile der Unternehmensadresse ein.',
    businessCity: 'Geben Sie den Ort des Unternehmens ein.',
    businessSubdivision:
      'Geben Sie das Bundesland, die Provinz oder die Region des Unternehmens ein.',
    businessPostalCode: 'Geben Sie die Postleitzahl des Unternehmens ein.',
    'person-name-first': 'Geben Sie den Vornamen dieser Person ein.',
    'person-name-last': 'Geben Sie den Nachnamen dieser Person ein.',
    'person-birthdate': 'Geben Sie den Geburtsmonat oder das Geburtsdatum dieser Person ein.',
    'website-url': 'Geben Sie die Adresse der Website ein.',
  },
  errors: {
    tooLong: 'Geben Sie höchstens {{max}} Zeichen ein.',
    date: 'Geben Sie ein gültiges Datum ein.',
    phone: 'Geben Sie die Nummer mit Ländervorwahl ein, etwa +1 202 555 0143.',
    email: 'Geben Sie eine E-Mail-Adresse im richtigen Format ein, zum Beispiel name@example.com.',
    zip: 'Geben Sie einen 5-stelligen ZIP-Code oder einen ZIP+4-Code wie 12345-6789 ein.',
    url: 'Geben Sie die vollständige Webadresse mit https:// oder http:// ein, etwa https://www.example.com.',
    lei: 'Geben Sie die 20-stellige LEI genau so ein, wie sie eingetragen ist.',
    registrationGb: 'Geben Sie die 8-stellige Unternehmensnummer ein, etwa 01234567 oder SC123456.',
    registrationUs: 'Geben Sie den CIK ein: bis zu 10 Ziffern.',
    registration: 'Geben Sie bis zu 20 Buchstaben und Ziffern ohne Leerzeichen ein.',
    birthMonth: 'Geben Sie den Monat als YYYY-MM oder das Datum als YYYY-MM-DD ein.',
    refused: 'Dies wurde nicht akzeptiert. Prüfen Sie die Angabe und versuchen Sie es erneut.',
  },
};
