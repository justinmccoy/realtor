/**
 * Where the client site lives, so the admin app can link to a listing as the
 * client sees it. `deploy-frontends.sh` bakes VITE_CUSTOMER_URL in from the
 * Frontend stack's output; without it, an `admin.<domain>` hostname gives
 * the answer away (admin.genauhere.de → genauhere.de).
 */
export function customerSiteUrl(configured: string | undefined, adminOrigin: string): string | null {
  const explicit = configured?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const m = /^(https?:\/\/)admin\.(.+)$/i.exec(adminOrigin);
  return m ? `${m[1]}${m[2]}` : null;
}

/** The client site's detail route for one listing (see customer-web App.tsx). */
export function listingPreviewUrl(customerSite: string, listingId: string): string {
  return `${customerSite}/#listing-${listingId}`;
}
