import type { Widen } from '../../i18n/locales/en';
import type { screenEn } from './en';

/**
 * Arabic messages of the screen step and the server-position screens (C148.7, C150.5, C151.2,
 * C158.5, C171.4). Machine-drafted by the build agents (C161.5). Instructions use «يُرجى» with a
 * verbal noun, so no imperative is gendered; examples and web addresses stay in Latin script.
 */
export const screenAr: Widen<typeof screenEn> = {
  continue: 'متابعة',
  heading: 'بياناتك',
  required: 'الحقول المميزة بعلامة * مطلوبة.',
  choose: 'الاختيار…',
  set: 'سبق تقديمه. يُرجى كتابة قيمة جديدة لتغييره.',
  summary: 'يُرجى مراجعة هذه الإجابات:',
  errors: {
    required: 'يُرجى إدخال قيمة أو اختيارها.',
    tooShort: 'يُرجى إدخال {{limit}} حرفًا على الأقل.',
    tooLong: 'يُرجى إدخال {{limit}} حرفًا على الأكثر.',
    pattern: 'هذه القيمة ليست بالتنسيق المتوقع.',
    number: 'يُرجى إدخال رقم.',
    tooSmall: 'يُرجى إدخال {{limit}} أو أكثر.',
    tooLarge: 'يُرجى إدخال {{limit}} أو أقل.',
    date: 'يُرجى إدخال تاريخ.',
    dateTooEarly: 'يُرجى إدخال {{limit}} أو تاريخ لاحق.',
    dateTooLate: 'يُرجى إدخال {{limit}} أو تاريخ سابق.',
    email: 'يُرجى إدخال عنوان بريد إلكتروني، مثل name@example.com.',
    phone: 'يُرجى إدخال رقم هاتف مع رمز البلد.',
    url: 'يُرجى إدخال عنوان ويب يبدأ بـ https://.',
    option: 'يُرجى اختيار أحد الخيارات.',
    country: 'يُرجى اختيار أحد البلدان.',
    refused: 'لم تُقبل هذه القيمة. يُرجى التحقق منها والمحاولة مرة أخرى.',
  },
  address: {
    street1: 'عنوان الشارع',
    street2: 'الشقة أو المبنى (اختياري)',
    city: 'المدينة',
    subdivision: 'الولاية أو المقاطعة أو المنطقة',
    postalCode: 'الرمز البريدي',
    country: 'البلد',
  },
  saving: 'جارٍ حفظ إجاباتك…',
  cancel: {
    title: 'التوقف الآن؟',
    message: 'تُحفظ إجاباتك حتى الآن. يمكن العودة بالرابط نفسه للمتابعة.',
    confirm: 'نعم، التوقف الآن',
    keep: 'لا، المتابعة',
    stopped: 'تم التوقف الآن',
    stoppedMessage: 'يمكن العودة بالرابط نفسه للمتابعة من حيث توقفت.',
  },
  unavailable: 'لا يمكن عرض هذه الشاشة في هذا الإصدار.',
  help: 'المساعدة والخصوصية',
  helpLink: 'الحصول على المساعدة',
  privacyLink: 'إشعار الخصوصية',
  waiting: {
    title: 'لحظة من فضلك',
    message: 'جارٍ تجهيز الخطوة التالية…',
  },
  halted: {
    title: 'لا يمكن متابعة هذا التحقق',
    message: 'حال أمرٌ دون متابعة هذا التحقق. يُرجى التواصل مع الجهة التي طلبت التحقق.',
  },
  redirect: {
    announce: 'اكتمل الجزء الخاص بك. يُرجى استخدام «متابعة» للعودة إلى الموقع الذي أتيت منه.',
    continue: 'متابعة',
  },
  extend: {
    warning: 'بقيت نحو {{seconds}} ثانية لالتقاط الصور. هل تحتاج إلى وقت إضافي؟',
    button: 'وقت إضافي',
    extended: 'أُضيف وقت إضافي.',
    failed: 'تعذّرت إضافة وقت. يُرجى التقاط الصور الآن، أو البدء من جديد إذا انتهى الوقت.',
  },
};
