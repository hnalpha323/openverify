import type { Widen } from '../../../i18n/locales/en';
import type { documentEn } from './en';

/**
 * Arabic messages of the document step (C60, C64.1). Machine-drafted by the build agents (C161.5).
 * Every plural message has Arabic's six forms (C161.6): `zero` (a count of 0, which the guidance
 * never sends), `one` (1), `two` (2), `few` (3 to 10), `many` (11 to 99) and `other` (100 and up).
 */
export const documentAr: Widen<typeof documentEn> = {
  title: 'رفع مستند',
  intro: 'يُرجى رفع مستند يظهر فيه الاسم الكامل والعنوان.',
  accepted: 'يمكن رفع أحد المستندات التالية:',
  types: {
    utility_bill_zero: 'فاتورة خدمات مؤرخة خلال آخر {{count}} يوم',
    utility_bill_one: 'فاتورة خدمات مؤرخة خلال اليوم الأخير',
    utility_bill_two: 'فاتورة خدمات مؤرخة خلال اليومين الأخيرين',
    utility_bill_few: 'فاتورة خدمات مؤرخة خلال آخر {{count}} أيام',
    utility_bill_many: 'فاتورة خدمات مؤرخة خلال آخر {{count}} يومًا',
    utility_bill_other: 'فاتورة خدمات مؤرخة خلال آخر {{count}} يوم',
    bank_statement_zero: 'كشف حساب بنكي مؤرخ خلال آخر {{count}} يوم',
    bank_statement_one: 'كشف حساب بنكي مؤرخ خلال اليوم الأخير',
    bank_statement_two: 'كشف حساب بنكي مؤرخ خلال اليومين الأخيرين',
    bank_statement_few: 'كشف حساب بنكي مؤرخ خلال آخر {{count}} أيام',
    bank_statement_many: 'كشف حساب بنكي مؤرخ خلال آخر {{count}} يومًا',
    bank_statement_other: 'كشف حساب بنكي مؤرخ خلال آخر {{count}} يوم',
    pay_stub_zero: 'قسيمة راتب مؤرخة خلال آخر {{count}} يوم',
    pay_stub_one: 'قسيمة راتب مؤرخة خلال اليوم الأخير',
    pay_stub_two: 'قسيمة راتب مؤرخة خلال اليومين الأخيرين',
    pay_stub_few: 'قسيمة راتب مؤرخة خلال آخر {{count}} أيام',
    pay_stub_many: 'قسيمة راتب مؤرخة خلال آخر {{count}} يومًا',
    pay_stub_other: 'قسيمة راتب مؤرخة خلال آخر {{count}} يوم',
    lease: 'عقد إيجار ما زال ساريًا',
    tax_document: 'مستند ضريبي من آخر سنة ضريبية',
  },
  typeNames: {
    utility_bill: 'فاتورة خدمات',
    bank_statement: 'كشف حساب بنكي',
    lease: 'عقد إيجار',
    pay_stub: 'قسيمة راتب',
    tax_document: 'مستند ضريبي',
  },
  formats: 'يُرجى رفعه بصيغة {{formats}} بحجم لا يتجاوز {{size}}.',
  pages_zero: 'يمكن أن يحتوي ملف PDF على {{count}} صفحة كحد أقصى.',
  pages_one: 'يمكن أن يحتوي ملف PDF على صفحة واحدة فقط.',
  pages_two: 'يمكن أن يحتوي ملف PDF على صفحتين كحد أقصى.',
  pages_few: 'يمكن أن يحتوي ملف PDF على {{count}} صفحات كحد أقصى.',
  pages_many: 'يمكن أن يحتوي ملف PDF على {{count}} صفحة كحد أقصى.',
  pages_other: 'يمكن أن يحتوي ملف PDF على {{count}} صفحة كحد أقصى.',
  chooseFile: 'اختيار ملف',
  chooseFileLabel: 'اختيار ملف للمستند',
  takePhoto: 'التقاط صورة',
  takePhotoLabel: 'التقاط صورة للمستند',
  picked: 'الملف: {{name}}، {{size}}',
  pickedHint: 'يُرجى التأكد من أنه المستند الصحيح، ثم رفعه.',
  upload: 'رفع هذا الملف',
  chooseAnother: 'اختيار ملف آخر',
  takeAnother: 'التقاط صورة أخرى',
  uploading: 'جارٍ رفع المستند…',
  fileErrors: {
    empty: 'هذا الملف فارغ. يُرجى اختيار ملف آخر.',
    'too-large':
      'حجم هذا الملف أكبر من {{size}}. يُرجى اختيار ملف أصغر، مثل صورة للمستند أو ملف PDF بعدد صفحات أقل.',
    'unsupported-type':
      'لا يمكننا استخدام هذا النوع من الملفات. يُرجى اختيار ملف بصيغة {{formats}}.',
    unreadable: 'تعذّرت قراءة هذا الملف. يُرجى اختيار ملف آخر.',
  },
};
