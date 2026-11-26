/**
 * English messages of the document step (C60, C64.1), under `document` in the flow's messages.
 * A picked file is named by the user's own file name and its size, shown on the device only; no
 * message shows its contents.
 */
export const documentEn = {
  title: 'Upload a document',
  intro: 'Upload a document that shows your full name and your address.',
  accepted: 'You can upload one of these:',
  // C52.2: the window comes from the guidance's `max-age-days`; a lease and a tax document follow
  // their own rules (C60.6).
  types: {
    utility_bill_one: 'A utility bill dated within the last day',
    utility_bill_other: 'A utility bill dated within the last {{count}} days',
    bank_statement_one: 'A bank statement dated within the last day',
    bank_statement_other: 'A bank statement dated within the last {{count}} days',
    pay_stub_one: 'A pay stub dated within the last day',
    pay_stub_other: 'A pay stub dated within the last {{count}} days',
    lease: 'A lease or rental agreement that is still in force',
    tax_document: 'A tax document from the latest tax year',
  },
  // Before the guidance is known, the step's own documents, without their window.
  typeNames: {
    utility_bill: 'A utility bill',
    bank_statement: 'A bank statement',
    lease: 'A lease or rental agreement',
    pay_stub: 'A pay stub',
    tax_document: 'A tax document',
  },
  formats: 'Upload it as a {{formats}} file of up to {{size}}.',
  pages_one: 'A PDF can have only {{count}} page.',
  pages_other: 'A PDF can have up to {{count}} pages.',
  chooseFile: 'Choose a file',
  chooseFileLabel: 'Choose a file of your document',
  takePhoto: 'Take a photo',
  takePhotoLabel: 'Take a photo of your document',
  picked: 'Your file: {{name}}, {{size}}',
  pickedHint: 'Check that it is the right document, then upload it.',
  upload: 'Upload this file',
  chooseAnother: 'Choose another file',
  takeAnother: 'Take another photo',
  uploading: 'Uploading your document…',
  fileErrors: {
    empty: 'This file is empty. Choose another file.',
    'too-large':
      'This file is larger than {{size}}. Choose a smaller file, such as a photo of the document or a PDF with fewer pages.',
    'unsupported-type': 'We cannot use this type of file. Choose a {{formats}} file.',
    unreadable: 'We could not read this file. Choose another file.',
  },
};
