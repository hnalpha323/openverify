/** A link that looks like the console's buttons, for navigation actions such as "New webhook". */
const BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export const PRIMARY_LINK_BUTTON = `${BASE} bg-primary text-on-primary hover:bg-primary-hover`;
export const SECONDARY_LINK_BUTTON = `${BASE} border border-line bg-surface text-ink hover:bg-canvas`;
