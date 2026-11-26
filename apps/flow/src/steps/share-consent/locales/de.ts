import type { Widen } from '../../../i18n/locales/en';
import type { shareConsentEn } from './en';

/**
 * German messages of the share-consent step (C238.6, C237.6). Machine-drafted by the build agents
 * (C161.5): the `consent` texts are legal texts, drafted and not reviewed, and pending counsel's
 * review in English (C238.10). Placeholders keep their `{{name}}` syntax; the server fills them.
 */
export const shareConsentDe: Widen<typeof shareConsentEn> = {
  consent: {
    title: 'Ihre geprüften Angaben mit {{recipient}} teilen',
    source:
      '{{source}} bittet um Ihre Zustimmung, die über Sie geprüften Angaben mit {{recipient}} zu teilen, damit {{recipient}} diese Prüfung wiederverwenden kann, statt Sie erneut prüfen zu lassen.\n\nWas geteilt wird: {{categories}}. Ohne Ihre Zustimmung wird nichts geteilt, und wenn Sie nicht teilen, wird Ihre Prüfung nicht abgebrochen.\n\nIhre Zustimmung gilt für eine einzige Weitergabe an {{recipient}} und nur für diesen Zweck. Sie endet nach {{expires}}, wenn die Angaben bis dahin nicht geteilt wurden.\n\nUm Ihre Zustimmung zu widerrufen, {{withdraw}}. Der Widerruf stoppt jede Weitergabe, die noch nicht erfolgt ist. Bereits geteilte Angaben bewahrt {{recipient}} nach der eigenen Datenschutzerklärung auf.',
    destination:
      '{{recipient}} bittet um Ihre Zustimmung, die von {{source}} über Sie geprüften Angaben zu erhalten, damit Sie sich nicht erneut prüfen lassen müssen.\n\nWas {{recipient}} erhält: {{categories}}. {{recipient}} verwendet sie nur, um Ihre Identität für diese Anfrage zu prüfen, und bewahrt sie {{retention}} lang auf. Ohne Ihre Zustimmung wird nichts übermittelt, und wenn Sie nicht teilen, wird Ihre Prüfung nicht abgebrochen: Sie werden dann hier geprüft.\n\nIhre Zustimmung endet nach {{expires}}, wenn die Angaben bis dahin nicht übermittelt wurden.\n\nUm Ihre Zustimmung zu widerrufen, {{withdraw}}. Der Widerruf stoppt jede Übermittlung, die noch nicht erfolgt ist.',
    'biometric-source':
      'Ich stimme zu, dass {{source}} meine biometrischen Daten mit {{recipient}} teilt: das Foto meines Gesichts auf meinem Ausweisdokument, mein Selfie und die Ergebnisse ihres Vergleichs.',
    'biometric-destination':
      'Ich stimme zu, dass {{recipient}} meine biometrischen Daten von {{source}} erhält: das Foto meines Gesichts auf meinem Ausweisdokument, mein Selfie und die Ergebnisse ihres Vergleichs. {{recipient}} bewahrt sie {{retention}} lang auf, nur um meine Identität zu prüfen.',
    accept: 'Ich stimme zu',
    decline: 'Nicht teilen',
    withdraw: 'Meine Zustimmung zum Teilen mit {{recipient}} widerrufen',
  },
  step: {
    sharedBy: 'Geteilt von',
    sharedWith: 'Geteilt mit',
    whatIsShared: 'Was geteilt wird',
    saving: 'Ihre Auswahl wird gespeichert …',
    biometricRequired:
      'Setzen Sie das Häkchen, um dem Teilen Ihrer biometrischen Daten zuzustimmen, oder wählen Sie „Nicht teilen“.',
    withdrawHeading: 'Ihre Zustimmung zum Teilen',
    withdrawIntro:
      'Sie haben zugestimmt, Ihre geprüften Angaben mit {{recipient}} zu teilen. Sie können diese Zustimmung widerrufen, solange diese Prüfung offen ist.',
    withdrawing: 'Ihre Zustimmung wird widerrufen …',
    withdrawn: 'Sie haben Ihre Zustimmung zum Teilen mit {{recipient}} widerrufen.',
  },
  categories: {
    'identity-fields': 'Ihre Identitätsangaben, etwa Ihr Name und Ihr Geburtsdatum',
    'contact-fields': 'Ihre Kontaktdaten, etwa Ihre E-Mail-Adresse und Telefonnummer',
    'other-fields': 'weitere Angaben, die Sie eingegeben haben',
    'document-images': 'Bilder Ihrer Ausweisdokumente',
    biometric: 'biometrische Daten: Fotos Ihres Gesichts und die Ergebnisse ihres Vergleichs',
    'check-results': 'die Ergebnisse der Prüfungen Ihrer Angaben',
  },
};
