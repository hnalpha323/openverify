/**
 * C160.6, C160.9 (`api-themes`, Workflow 9B): the theme's logo in the header. Its bytes come from the
 * session's asset loader and are sniffed as PNG, JPEG or WebP before a `blob:` URL is made (the
 * flow's `img-src` allows `blob:`); a decorative logo has an empty alt and the organisation's
 * display name shows as text beside it; with no logo, or bytes that are not an image, the header
 * keeps the flow's own name. The `blob:` URL is revoked when the logo changes or the header goes.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { currentThemeAssetLoader, currentThemeBranding, subscribeThemeBranding } from './apply';
import { logoTypeOf, type ThemeAssetLoader } from './assets';

export interface ThemeBrandingProps {
  /** What the header shows with no logo: the flow's own name. */
  readonly fallback: string;
  /** Phase 7's `organization-display-name`, shown as text beside a decorative logo. */
  readonly organizationDisplayName?: string | null;
  /** Reads the logo's bytes; without it no logo is shown. */
  readonly loadAsset?: ThemeAssetLoader;
  /** The alt text of a logo's `alt-key`, from the session's copy. */
  readonly translate?: (key: string) => string;
}

/** The header's brand: the theme's logo, or the flow's own name. */
export function ThemeBranding({
  fallback,
  organizationDisplayName = null,
  loadAsset: givenLoader,
  translate = (key) => key,
}: ThemeBrandingProps) {
  const logo = useSyncExternalStore(subscribeThemeBranding, currentThemeBranding);
  const assetId = logo?.['asset-id'] ?? null;
  // Workflow 9B: without a loader of its own, the one the session's theme was applied with.
  const loadAsset = givenLoader ?? currentThemeAssetLoader();
  const [source, setSource] = useState<{ assetId: string; url: string } | null>(null);

  useEffect(() => {
    if (assetId === null || loadAsset === undefined) {
      return undefined;
    }
    const controller = new AbortController();
    let url: string | null = null;
    loadAsset(assetId, controller.signal).then(
      ({ bytes }) => {
        const type = logoTypeOf(bytes);
        if (controller.signal.aborted || type === null) {
          return;
        }
        url = URL.createObjectURL(new Blob([bytes], { type }));
        setSource({ assetId, url });
      },
      () => {
        // The flow's own name stays: a logo that cannot be read is not shown.
      },
    );
    return () => {
      controller.abort();
      if (url !== null) {
        URL.revokeObjectURL(url);
      }
    };
  }, [assetId, loadAsset]);

  if (logo === null || source?.assetId !== logo['asset-id']) {
    return <span className="font-semibold">{fallback}</span>;
  }
  const alt = logo.decorative || logo['alt-key'] === null ? '' : translate(logo['alt-key']);
  return (
    <span className="flex items-center gap-2">
      <img src={source.url} alt={alt} className="h-8 w-auto" />
      {logo.decorative && organizationDisplayName !== null ? (
        <span className="font-semibold">{organizationDisplayName}</span>
      ) : null}
    </span>
  );
}
