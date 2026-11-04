import { API_PREFIX } from "@jj/shared";
import { customerSiteUrl } from "./lib/customerSite";

export const API_BASE = `${import.meta.env.VITE_API_BASE ?? ""}${API_PREFIX}`;

export const COGNITO = {
  poolId: import.meta.env.VITE_ADMIN_POOL_ID ?? "",
  clientId: import.meta.env.VITE_ADMIN_CLIENT_ID ?? ""
};

export const configOk = Boolean(COGNITO.poolId && COGNITO.clientId);

/** Client site base URL for preview links, or null when it can't be known. */
export const CUSTOMER_SITE = customerSiteUrl(
  import.meta.env.VITE_CUSTOMER_URL,
  typeof location === "undefined" ? "" : location.origin
);
