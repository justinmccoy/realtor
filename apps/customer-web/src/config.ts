import { API_PREFIX } from "@jj/shared";

export const API_BASE = `${import.meta.env.VITE_API_BASE ?? ""}${API_PREFIX}`;

export const COGNITO = {
  poolId: import.meta.env.VITE_CUSTOMER_POOL_ID ?? "",
  clientId: import.meta.env.VITE_CUSTOMER_CLIENT_ID ?? ""
};

export const configOk = Boolean(COGNITO.poolId && COGNITO.clientId);
