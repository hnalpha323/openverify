/**
 * `flow-renderer`'s screens for the mocked suite (Workflow 9A): a screen of every component kind
 * with its operator copy in English and Arabic (synthetic texts), the positions around it, and a
 * helper that opens the flow at a served position. Every value is synthetic.
 */
import type { Page } from '@playwright/test';
import { MockFlowApi, PHASE5_CONSENT_GIVEN, flowLink } from './mock-flow-api';
import { at, serve, type ServedPosition } from './mock-flow-renderer';

const option = (key: string, value: string) => ({ key, value, labelKey: `about.${key}` });

/** C148.2: one of every kind, the second title and a conditional field included. */
export const EVERY_KIND_SCREEN = {
  id: 'about',
  type: 'screen',
  components: [
    { id: 'title', kind: 'text', variant: 'title', copyKey: 'about.title' },
    { id: 'intro', kind: 'text', variant: 'body', copyKey: 'about.intro' },
    { id: 'steps', kind: 'stepper', labelKeys: ['about.one', 'about.two'], current: 0 },
    {
      id: 'row',
      kind: 'container',
      direction: 'vertical',
      children: [
        {
          id: 'name',
          kind: 'text_input',
          field: 'name_first',
          labelKey: 'about.name',
          required: true,
        },
        { id: 'notes', kind: 'text_area', field: 'notes', labelKey: 'about.notes' },
      ],
    },
    { id: 'age', kind: 'number', field: 'age', labelKey: 'about.age', min: 18 },
    { id: 'birth', kind: 'date', field: 'birthdate', labelKey: 'about.birth' },
    { id: 'mail', kind: 'email', field: 'email', labelKey: 'about.mail' },
    { id: 'tel', kind: 'phone', field: 'mobile', labelKey: 'about.tel' },
    { id: 'site', kind: 'url', field: 'site', labelKey: 'about.site' },
    { id: 'tax', kind: 'masked_text', field: 'tax_number', labelKey: 'about.tax' },
    {
      id: 'colour',
      kind: 'select',
      field: 'colour',
      labelKey: 'about.colour',
      options: [option('red', 'r'), option('blue', 'b')],
    },
    {
      id: 'pet',
      kind: 'radio_group',
      field: 'has_pet',
      labelKey: 'about.pet',
      options: [option('yes', 'yes'), option('no', 'no')],
    },
    {
      id: 'pet_name',
      kind: 'text_input',
      field: 'pet_name',
      labelKey: 'about.pet_name',
      required: true,
      visibleWhen: { '===': [{ var: 'screen.has_pet' }, 'yes'] },
    },
    { id: 'agree', kind: 'checkbox', field: 'agree', labelKey: 'about.agree' },
    {
      id: 'tags',
      kind: 'checkbox_group',
      field: 'tags',
      labelKey: 'about.tags',
      options: [option('cats', 'c'), option('dogs', 'd')],
    },
    { id: 'home', kind: 'country_select', field: 'country', labelKey: 'about.home' },
    {
      id: 'addr',
      kind: 'address',
      labelKey: 'about.addr',
      fields: { street1: 'street', city: 'city', postalCode: 'postcode', country: 'addr_country' },
    },
    {
      id: 'foot',
      kind: 'footer',
      children: [
        { id: 'go', kind: 'button', labelKey: 'about.go', action: 'submit' },
        { id: 'skip', kind: 'button', labelKey: 'about.skip', action: 'submit', port: 'skip' },
      ],
    },
  ],
} as const;

const EN = {
  'about.title': 'About you',
  'about.intro': 'A few details before we check your ID.',
  'about.one': 'Details',
  'about.two': 'ID',
  'about.name': 'First name',
  'about.notes': 'Anything else',
  'about.age': 'Age',
  'about.birth': 'Date of birth',
  'about.mail': 'Email address',
  'about.tel': 'Mobile number',
  'about.site': 'Website',
  'about.tax': 'Tax number',
  'about.colour': 'Favourite colour',
  'about.red': 'Red',
  'about.blue': 'Blue',
  'about.pet': 'Do you have a pet?',
  'about.yes': 'Yes',
  'about.no': 'No',
  'about.pet_name': 'Pet name',
  'about.agree': 'I confirm these details are mine',
  'about.tags': 'Animals you like',
  'about.cats': 'Cats',
  'about.dogs': 'Dogs',
  'about.home': 'Country of residence',
  'about.addr': 'Home address',
  'about.go': 'Continue',
  'about.skip': 'Skip for now',
};

const AR = {
  'about.title': 'عنك',
  'about.intro': 'بعض التفاصيل قبل التحقق من هويتك.',
  'about.one': 'التفاصيل',
  'about.two': 'الهوية',
  'about.name': 'الاسم الأول',
  'about.notes': 'أي شيء آخر',
  'about.age': 'العمر',
  'about.birth': 'تاريخ الميلاد',
  'about.mail': 'البريد الإلكتروني',
  'about.tel': 'رقم الجوال',
  'about.site': 'الموقع الإلكتروني',
  'about.tax': 'الرقم الضريبي',
  'about.colour': 'اللون المفضل',
  'about.red': 'أحمر',
  'about.blue': 'أزرق',
  'about.pet': 'هل لديك حيوان أليف؟',
  'about.yes': 'نعم',
  'about.no': 'لا',
  'about.pet_name': 'اسم الحيوان الأليف',
  'about.agree': 'أؤكد أن هذه البيانات تخصني',
  'about.tags': 'الحيوانات المفضلة',
  'about.cats': 'القطط',
  'about.dogs': 'الكلاب',
  'about.home': 'بلد الإقامة',
  'about.addr': 'عنوان السكن',
  'about.go': 'متابعة',
  'about.skip': 'التخطي الآن',
};

/** The screen of every kind at the server's position, its copy in both languages. */
export const ON_EVERY_KIND: ServedPosition = {
  position: at('about', 'active', 'consent'),
  step: EVERY_KIND_SCREEN,
  values: { name_first: 'Sam', tax_number: { set: true } },
  copy: { messages: { en: EN, ar: AR } },
  locales: { enabled: ['en', 'ar'], default: 'en' },
};

/** The completion the server serves once the person's part ended. */
export const DONE: ServedPosition = {
  position: at('done', 'ended', 'about'),
  step: { id: 'done', type: 'completion' },
  inquiryStatus: 'completed',
};

/** Opens the flow past consent, the server serving `served`; answers the mock. */
export async function openAt(
  page: Page,
  served: ServedPosition,
  {
    language,
    styleVariant,
    flow,
    configure,
  }: {
    readonly language?: 'en' | 'es' | 'fr' | 'de' | 'ar';
    /**
     * The page's `style-variant` (C160.9): `dark` draws the built-in dark palette, which the
     * browser's `prefers-color-scheme` alone never does with no theme set (Workflow 9D).
     */
    readonly styleVariant?: 'light' | 'dark';
    readonly flow?: MockFlowApi['flow'];
    /** Sets up the rest of the mock (its handoff answers, say) before the page loads. */
    readonly configure?: (mock: MockFlowApi) => void;
  } = {},
): Promise<MockFlowApi> {
  const mock = new MockFlowApi();
  mock.consent = { ...PHASE5_CONSENT_GIVEN, textKeys: [...PHASE5_CONSENT_GIVEN.textKeys] };
  mock.inquiryStatus = 'pending';
  if (flow !== undefined) {
    mock.flow = flow;
  }
  configure?.(mock);
  serve(mock, served);
  await mock.install(page);
  const link = flowLink();
  const query = [
    ...(language === undefined ? [] : [`language=${language}`]),
    ...(styleVariant === undefined ? [] : [`style-variant=${styleVariant}`]),
  ].join('&');
  await page.goto(query === '' ? link : `/?${query}${link.slice(1)}`);
  return mock;
}
