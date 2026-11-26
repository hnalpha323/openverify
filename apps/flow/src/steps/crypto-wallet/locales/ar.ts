import type { Widen } from '../../../i18n/locales/en';
import type { cryptoWalletEn } from './en';

/**
 * Arabic messages of the crypto wallet step (C57, C64.1). Machine-drafted by the build agents
 * (C161.5). Network names are names and stay in Latin script.
 */
export const cryptoWalletAr: Widen<typeof cryptoWalletEn> = {
  title: 'إثبات التحكم في محفظة العملات المشفرة',
  intro:
    'يتم توقيع رسالة باستخدام المحفظة. توقيع الرسالة مجاني: لا يرسل أي معاملة ولا ينقل أي أموال.',
  network: 'الشبكة',
  networkIs: 'الشبكة: {{network}}',
  restarted:
    'انتهت المحاولة الأخيرة لأنه طُلب عدد كبير جدًا من الرسائل للتوقيع. يُرجى البدء من جديد.',
  wallet: {
    connect: 'ربط المحفظة',
    connectNamed: 'ربط {{name}}',
    connecting: 'في انتظار المحفظة…',
    signing: 'يُرجى توقيع الرسالة في المحفظة. تعرض المحفظة هذا الموقع وسبب الطلب.',
    submitting: 'جارٍ إرسال التوقيع…',
    pasteInstead: 'لصق توقيع بدلًا من ذلك',
    declined: 'تم رفض الطلب في المحفظة. يمكن المحاولة مرة أخرى عند الاستعداد.',
    failed: 'تعذّر على المحفظة إكمال الطلب. يُرجى المحاولة مرة أخرى، أو لصق توقيع بدلًا من ذلك.',
    failedNoPaste: 'تعذّر على المحفظة إكمال الطلب. يُرجى المحاولة مرة أخرى.',
    needed:
      'تتطلب هذه الخطوة محفظة في المتصفح. يُرجى فتح هذه الصفحة في متصفح مزوّد بإضافة محفظة، أو في متصفح تطبيق المحفظة.',
  },
  paste: {
    address: 'عنوان المحفظة',
    addressHint: 'يُرجى نسخه من المحفظة ثم لصقه هنا.',
    getMessage: 'الحصول على الرسالة المراد توقيعها',
    gettingMessage: 'جارٍ الحصول على الرسالة…',
    message: 'الرسالة المراد توقيعها',
    messageHint:
      'يُرجى توقيع هذه الرسالة بالضبط في المحفظة، ثم لصق التوقيع أدناه. يجب توقيعها قبل {{time}}.',
    copy: 'نسخ الرسالة',
    copied: 'تم نسخ الرسالة.',
    copyFailed: 'تعذّر نسخ الرسالة. يُرجى تحديدها ونسخها يدويًا.',
    signature: 'التوقيع',
    signedMessage: 'الرسالة الموقّعة (اختياري)',
    signedMessageHint:
      'تعرض بعض محافظ Solana البايتات التي وقّعتها. إن كانت محفظتك تعرضها، يُرجى لصقها هنا.',
    submit: 'إرسال التوقيع',
    submitting: 'جارٍ إرسال التوقيع…',
    otherAddress: 'استخدام عنوان آخر',
    walletInstead: 'استخدام محفظة المتصفح بدلًا من ذلك',
  },
  errors: {
    addressRequired: 'يُرجى إدخال عنوان المحفظة.',
    addressInvalid:
      'عنوان المحفظة هذا غير صالح للشبكة المختارة. يُرجى التأكد من نسخ العنوان كاملًا.',
    addressNotExpected:
      'هذا ليس عنوان المحفظة المطلوب التحقق منه. يُرجى استخدام عنوان المحفظة المتوقع.',
    chainNotOffered: 'هذه الشبكة غير مقبولة هنا. يُرجى اختيار شبكة أخرى.',
    signatureRequired: 'يُرجى لصق التوقيع من المحفظة.',
    signatureTooLong: 'هذا التوقيع طويل جدًا. يُرجى لصق التوقيع فقط.',
    challengeInvalid:
      'انتهت صلاحية هذه الرسالة أو سبق استخدامها. يُرجى الحصول على رسالة جديدة لتوقيعها.',
  },
  chains: {
    bitcoin: 'Bitcoin',
    bitcoinTestnet: 'Bitcoin (شبكة اختبار)',
    litecoin: 'Litecoin',
    dogecoin: 'Dogecoin',
    solana: 'Solana',
    tron: 'TRON',
    xrpl: 'XRP Ledger',
    ethereum: 'Ethereum',
    optimism: 'OP Mainnet',
    bnb: 'BNB Smart Chain',
    polygon: 'Polygon',
    base: 'Base',
    arbitrum: 'Arbitrum One',
    sepolia: 'Sepolia (شبكة اختبار)',
    evm: 'شبكة EVM رقم {{number}}',
  },
};
