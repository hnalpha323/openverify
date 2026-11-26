import { useTranslation } from 'react-i18next';

/**
 * Shown on every screen of a sandbox session (C19), so testers never mistake it for a real
 * verification. A named note, not a live region: it must not interrupt a screen reader.
 */
export function SandboxBanner() {
  const { t } = useTranslation();

  return (
    <div
      role="note"
      aria-label={t('sandbox.label')}
      className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <strong className="font-semibold">{t('sandbox.label')}.</strong> {t('sandbox.message')}
    </div>
  );
}
