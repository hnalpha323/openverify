/** Where the Connect pages are (C242), in one module every Connect component may import. */

/** Settings → Connect, which the settings page and the share-token pages link. */
export const CONNECT_SETTINGS_PATH = '/settings/connect';

/** Where a connection's page is. */
export const connectionHref = (id: string) =>
  `${CONNECT_SETTINGS_PATH}/connections/${encodeURIComponent(id)}`;

/** The share tokens' list (C242.2). */
export const SHARE_TOKENS_PATH = `${CONNECT_SETTINGS_PATH}/share-tokens`;

/** Where a share token's page is. */
export const shareTokenHref = (id: string) => `${SHARE_TOKENS_PATH}/${encodeURIComponent(id)}`;
