import type { Widen } from '../../../i18n/locales/en';
import type { documentEn } from './en';

/**
 * German messages of the document step (C60, C64.1). Machine-drafted by the build agents (C161.5).
 * German has the plural categories `one` and `other` only (C161.6).
 */
export const documentDe: Widen<typeof documentEn> = {
  title: 'Dokument hochladen',
  intro: 'Laden Sie ein Dokument hoch, auf dem Ihr vollständiger Name und Ihre Adresse stehen.',
  accepted: 'Sie können eines der folgenden Dokumente hochladen:',
  types: {
    utility_bill_one: 'Eine Versorgerrechnung, die höchstens einen Tag alt ist',
    utility_bill_other: 'Eine Versorgerrechnung, die höchstens {{count}} Tage alt ist',
    bank_statement_one: 'Ein Kontoauszug, der höchstens einen Tag alt ist',
    bank_statement_other: 'Ein Kontoauszug, der höchstens {{count}} Tage alt ist',
    pay_stub_one: 'Eine Gehaltsabrechnung, die höchstens einen Tag alt ist',
    pay_stub_other: 'Eine Gehaltsabrechnung, die höchstens {{count}} Tage alt ist',
    lease: 'Ein noch gültiger Miet- oder Pachtvertrag',
    tax_document: 'Ein Steuerdokument aus dem letzten Steuerjahr',
  },
  typeNames: {
    utility_bill: 'Eine Versorgerrechnung',
    bank_statement: 'Ein Kontoauszug',
    lease: 'Ein Miet- oder Pachtvertrag',
    pay_stub: 'Eine Gehaltsabrechnung',
    tax_document: 'Ein Steuerdokument',
  },
  formats: 'Laden Sie es als {{formats}}-Datei mit höchstens {{size}} hoch.',
  pages_one: 'Ein PDF darf nur {{count}} Seite haben.',
  pages_other: 'Ein PDF darf bis zu {{count}} Seiten haben.',
  chooseFile: 'Datei auswählen',
  chooseFileLabel: 'Eine Datei Ihres Dokuments auswählen',
  takePhoto: 'Foto aufnehmen',
  takePhotoLabel: 'Ein Foto Ihres Dokuments aufnehmen',
  picked: 'Ihre Datei: {{name}}, {{size}}',
  pickedHint: 'Prüfen Sie, ob es das richtige Dokument ist, und laden Sie es dann hoch.',
  upload: 'Diese Datei hochladen',
  chooseAnother: 'Andere Datei auswählen',
  takeAnother: 'Anderes Foto aufnehmen',
  uploading: 'Ihr Dokument wird hochgeladen…',
  fileErrors: {
    empty: 'Diese Datei ist leer. Wählen Sie eine andere Datei aus.',
    'too-large':
      'Diese Datei ist größer als {{size}}. Wählen Sie eine kleinere Datei, etwa ein Foto des Dokuments oder ein PDF mit weniger Seiten.',
    'unsupported-type':
      'Diesen Dateityp können wir nicht verwenden. Wählen Sie eine {{formats}}-Datei aus.',
    unreadable: 'Wir konnten diese Datei nicht lesen. Wählen Sie eine andere Datei aus.',
  },
};
