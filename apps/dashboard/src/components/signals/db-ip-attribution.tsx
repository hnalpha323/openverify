import { LINK_CLASS } from '../link-styles';

export const DB_IP_URL = 'https://db-ip.com';
export const DB_IP_ATTRIBUTION = 'IP geolocation by DB-IP';

/**
 * The DB-IP attribution (C92.8, decision 2): DB-IP's CC BY 4.0 terms ask a page that shows its
 * results for a link back, so every console surface that shows an IP location, or a distance
 * computed from one, carries this one line.
 */
export function DbIpAttribution() {
  return (
    <p className="text-xs text-ink-muted">
      <a href={DB_IP_URL} className={LINK_CLASS} rel="noopener noreferrer">
        {DB_IP_ATTRIBUTION}
      </a>
    </p>
  );
}
