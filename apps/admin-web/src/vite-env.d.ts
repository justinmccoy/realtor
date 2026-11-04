/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_ADMIN_POOL_ID?: string;
  readonly VITE_ADMIN_CLIENT_ID?: string;
  /** Client site base URL (https://genauhere.de); baked in by deploy-frontends.sh. */
  readonly VITE_CUSTOMER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
