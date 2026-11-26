/**
 * The console's shared Phase 9 strings (C155.9): the navigation entries and the template page's
 * sections, which every 9C area links to. `dashboard-flow-builder`'s.
 */
import { defineCopy } from './catalog';

export const CONSOLE_COPY = defineCopy({
  nav: {
    insights: 'Insights',
    analytics: 'Analytics',
    exports: 'Exports',
    bulkReports: 'Bulk reports',
    themeSets: 'Theme sets',
    notificationPreferences: 'Notification settings',
  },
  templateTabs: {
    label: 'Template sections',
    overview: 'Overview',
    flow: 'Flow',
    settings: 'Settings',
    translations: 'Translations',
    theme: 'Theme',
    preview: 'Preview',
  },
});
