import type { Widen } from '../../../i18n/locales/en';
import type { shareConsentEn } from './en';

/**
 * Arabic messages of the share-consent step (C238.6, C237.6), shown right to left (C161.3).
 * Machine-drafted by the build agents (C161.5): the `consent` texts are legal texts, drafted and not
 * reviewed, and pending counsel's review in English (C238.10). Instructions use «يُرجى» with a
 * verbal noun, so no imperative is gendered (C161.6). Placeholders keep their `{{name}}` syntax; the
 * server fills them, and the flow isolates every value it shows itself with `<bdi>`.
 */
export const shareConsentAr: Widen<typeof shareConsentEn> = {
  consent: {
    title: 'مشاركة بياناتك التي جرى التحقق منها مع {{recipient}}',
    source:
      'تطلب {{source}} موافقتك على مشاركة البيانات التي تحققت منها عنك مع {{recipient}}، حتى تتمكن {{recipient}} من إعادة استخدام هذا التحقق بدلًا من أن تطلب منك التحقق مرة أخرى.\n\nما تجري مشاركته: {{categories}}. لا تجري مشاركة أي شيء دون موافقتك، واختيار عدم المشاركة لا يوقف عملية التحقق.\n\nتشمل موافقتك مشاركة واحدة مع {{recipient}} لهذا الغرض وحده، وتنتهي بعد {{expires}} إذا لم تجرِ المشاركة قبل ذلك.\n\nلسحب موافقتك: {{withdraw}}. يوقف سحب الموافقة أي مشاركة لم تحدث بعد. أما البيانات التي جرت مشاركتها فتحتفظ بها {{recipient}} وفق إشعار الخصوصية الخاص بها.',
    destination:
      'تطلب {{recipient}} موافقتك على تلقي البيانات التي تحققت منها {{source}} عنك، حتى لا تحتاج إلى التحقق مرة أخرى.\n\nما تتلقاه {{recipient}}: {{categories}}. تستخدم {{recipient}} هذه البيانات للتحقق من هويتك في هذا الطلب فقط، وتحتفظ بها مدة {{retention}}. لا يجري تلقي أي شيء دون موافقتك، واختيار عدم المشاركة لا يوقف عملية التحقق: يجري التحقق هنا بدلًا من ذلك.\n\nتنتهي موافقتك بعد {{expires}} إذا لم يجرِ تلقي البيانات قبل ذلك.\n\nلسحب موافقتك: {{withdraw}}. يوقف سحب الموافقة أي نقل لم يحدث بعد.',
    'biometric-source':
      'أوافق على أن تشارك {{source}} بياناتي البيومترية مع {{recipient}}: صورة وجهي في وثيقة هويتي، وصورتي الذاتية، ونتائج المقارنة بينهما.',
    'biometric-destination':
      'أوافق على أن تتلقى {{recipient}} بياناتي البيومترية من {{source}}: صورة وجهي في وثيقة هويتي، وصورتي الذاتية، ونتائج المقارنة بينهما. تحتفظ بها {{recipient}} مدة {{retention}} للتحقق من هويتي فقط.',
    accept: 'أوافق',
    decline: 'عدم المشاركة',
    withdraw: 'سحب موافقتي على المشاركة مع {{recipient}}',
  },
  step: {
    sharedBy: 'الجهة المشاركة',
    sharedWith: 'الجهة المتلقية',
    whatIsShared: 'ما تجري مشاركته',
    saving: 'جارٍ حفظ اختيارك…',
    biometricRequired:
      'يُرجى تحديد المربع للموافقة على مشاركة بياناتك البيومترية، أو اختيار عدم المشاركة.',
    withdrawHeading: 'موافقتك على المشاركة',
    withdrawIntro:
      'وافقت على مشاركة بياناتك التي جرى التحقق منها مع {{recipient}}. يمكنك سحب هذه الموافقة ما دامت عملية التحقق هذه مفتوحة.',
    withdrawing: 'جارٍ سحب موافقتك…',
    withdrawn: 'سحبت موافقتك على المشاركة مع {{recipient}}.',
  },
  categories: {
    'identity-fields': 'بيانات هويتك، مثل اسمك وتاريخ ميلادك',
    'contact-fields': 'بيانات الاتصال بك، مثل بريدك الإلكتروني ورقم هاتفك',
    'other-fields': 'بيانات أخرى أدخلتها',
    'document-images': 'صور وثائق هويتك',
    biometric: 'بيانات بيومترية: صور وجهك ونتائج المقارنة بينها',
    'check-results': 'نتائج عمليات التحقق من بياناتك',
  },
};
