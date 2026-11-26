/**
 * C156.2 (Workflow 9C, `dashboard-preview`): where the console reads a theme asset's bytes for the
 * preview frame (`app/templates/[id]/preview/assets/[assetId]/route.ts`), with the session cookie, so
 * the page can post them to the frame, whose policy has `connect-src 'none'`.
 */
export const previewAssetUrl =
  (templateId: string) =>
  (assetId: string): string =>
    `/templates/${encodeURIComponent(templateId)}/preview/assets/${encodeURIComponent(assetId)}`;
