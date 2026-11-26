import type { Widen } from '../../../i18n/locales/en';
import type { documentEn } from './en';

/**
 * French messages of the document step (C60, C64.1). Machine-drafted by the build agents (C161.5).
 * Plurals: `max-age-days` is at most 3,650 and `max-pages` at most 50, so neither reaches the
 * million that French `many` needs; `_one` and `_other` cover every count (C161.6).
 */
export const documentFr: Widen<typeof documentEn> = {
  title: 'Téléversez un document',
  intro: 'Téléversez un document qui indique votre nom complet et votre adresse.',
  accepted: 'Vous pouvez téléverser l’un de ces documents :',
  types: {
    utility_bill_one: 'Une facture d’énergie ou d’eau datée de moins d’un jour',
    utility_bill_other: 'Une facture d’énergie ou d’eau datée de moins de {{count}} jours',
    bank_statement_one: 'Un relevé bancaire daté de moins d’un jour',
    bank_statement_other: 'Un relevé bancaire daté de moins de {{count}} jours',
    pay_stub_one: 'Une fiche de paie datée de moins d’un jour',
    pay_stub_other: 'Une fiche de paie datée de moins de {{count}} jours',
    lease: 'Un bail ou contrat de location encore en vigueur',
    tax_document: 'Un document fiscal de la dernière année d’imposition',
  },
  typeNames: {
    utility_bill: 'Une facture d’énergie ou d’eau',
    bank_statement: 'Un relevé bancaire',
    lease: 'Un bail ou contrat de location',
    pay_stub: 'Une fiche de paie',
    tax_document: 'Un document fiscal',
  },
  formats: 'Téléversez-le au format {{formats}}, jusqu’à {{size}}.',
  pages_one: 'Un PDF ne peut comporter que {{count}} page.',
  pages_other: 'Un PDF peut comporter jusqu’à {{count}} pages.',
  chooseFile: 'Choisir un fichier',
  chooseFileLabel: 'Choisir un fichier de votre document',
  takePhoto: 'Prendre une photo',
  takePhotoLabel: 'Prendre une photo de votre document',
  picked: 'Votre fichier : {{name}}, {{size}}',
  pickedHint: 'Vérifiez qu’il s’agit du bon document, puis téléversez-le.',
  upload: 'Téléverser ce fichier',
  chooseAnother: 'Choisir un autre fichier',
  takeAnother: 'Prendre une autre photo',
  uploading: 'Téléversement de votre document…',
  fileErrors: {
    empty: 'Ce fichier est vide. Choisissez un autre fichier.',
    'too-large':
      'Ce fichier dépasse {{size}}. Choisissez un fichier plus petit, par exemple une photo du document ou un PDF avec moins de pages.',
    'unsupported-type':
      'Nous ne pouvons pas utiliser ce type de fichier. Choisissez un fichier {{formats}}.',
    unreadable: 'Nous n’avons pas pu lire ce fichier. Choisissez un autre fichier.',
  },
};
