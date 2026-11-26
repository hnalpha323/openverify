import type { Widen } from '../../../i18n/locales/en';
import type { documentEn } from './en';

/**
 * Spanish messages of the document step (C60, C64.1). Plurals: `max-age-days` is at most 3,650 and
 * `max-pages` at most 50, so neither reaches the million that Spanish `many` needs; `_one` and
 * `_other` cover every count (C161.6).
 */
export const documentEs: Widen<typeof documentEn> = {
  title: 'Sube un documento',
  intro: 'Sube un documento que muestre tu nombre completo y tu dirección.',
  accepted: 'Puedes subir uno de estos:',
  types: {
    utility_bill_one: 'Una factura de servicios con fecha del último día',
    utility_bill_other: 'Una factura de servicios con fecha de los últimos {{count}} días',
    bank_statement_one: 'Un extracto bancario con fecha del último día',
    bank_statement_other: 'Un extracto bancario con fecha de los últimos {{count}} días',
    pay_stub_one: 'Una nómina con fecha del último día',
    pay_stub_other: 'Una nómina con fecha de los últimos {{count}} días',
    lease: 'Un contrato de alquiler que siga vigente',
    tax_document: 'Un documento fiscal del último ejercicio fiscal',
  },
  typeNames: {
    utility_bill: 'Una factura de servicios',
    bank_statement: 'Un extracto bancario',
    lease: 'Un contrato de alquiler',
    pay_stub: 'Una nómina',
    tax_document: 'Un documento fiscal',
  },
  formats: 'Súbelo como archivo {{formats}} de hasta {{size}}.',
  pages_one: 'Un PDF solo puede tener {{count}} página.',
  pages_other: 'Un PDF puede tener hasta {{count}} páginas.',
  chooseFile: 'Elegir un archivo',
  chooseFileLabel: 'Elige un archivo de tu documento',
  takePhoto: 'Tomar una foto',
  takePhotoLabel: 'Toma una foto de tu documento',
  picked: 'Tu archivo: {{name}}, {{size}}',
  pickedHint: 'Comprueba que es el documento correcto y súbelo.',
  upload: 'Subir este archivo',
  chooseAnother: 'Elegir otro archivo',
  takeAnother: 'Tomar otra foto',
  uploading: 'Subiendo tu documento…',
  fileErrors: {
    empty: 'Este archivo está vacío. Elige otro archivo.',
    'too-large':
      'Este archivo ocupa más de {{size}}. Elige un archivo más pequeño, como una foto del documento o un PDF con menos páginas.',
    'unsupported-type': 'No podemos usar este tipo de archivo. Elige un archivo {{formats}}.',
    unreadable: 'No pudimos leer este archivo. Elige otro archivo.',
  },
};
