import type { Widen } from '../../../i18n/locales/en';
import type { nfcEn } from './en';

/** Arabic messages of the `nfc` step in a browser (C207.10). Machine-drafted (C161.5). */
export const nfcAr: Widen<typeof nfcEn> = {
  title: 'تتطلب هذه الخطوة تطبيق الجهة',
  needsApp: 'تتطلب قراءة شريحة المستند تطبيق الجهة؛ لا يستطيع المتصفح قراءتها.',
  otherWay: 'يمكنك المتابعة هنا بطريقة أخرى.',
  useAnotherWay: 'استخدام طريقة أخرى',
  switching: 'جارٍ الانتقال إلى طريقة أخرى…',
  noOtherWay:
    'تابع في تطبيق الجهة. إذا لم يكن التطبيق لديك، يُرجى التواصل مع الجهة التي طلبت التحقق.',
};
