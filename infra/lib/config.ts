import { App, RemovalPolicy } from "aws-cdk-lib";

export interface DomainConfig {
  /** Route53 hosted zone name, e.g. "example.com". */
  zoneName: string;
  /** Customer app FQDN, e.g. "www.example.com". */
  customer: string;
  /** Admin app FQDN, e.g. "admin.example.com". */
  admin: string;
}

export interface AppConfig {
  envName: "dev" | "prod";
  region: string;
  logRetentionDays: number;
  removalPolicy: RemovalPolicy;
  /** WAF adds ~$10+/mo per web ACL; off by default in dev. */
  enableWaf: boolean;
  alarmEmail?: string;
  domain?: DomainConfig;
  /** Origins allowed by API CORS (local Vite dev servers; custom domains are added automatically). */
  devOrigins: string[];
  /** Email notifications (SES). All optional — unset disables sending. */
  notify: {
    /** Verified SES identity used as the From address. */
    mailFrom?: string;
    /** Where client activity notifications go (JJ's inbox). */
    adminEmail?: string;
    /** App URLs used for links in emails (CloudFront or custom domains). */
    customerUrl?: string;
    adminUrl?: string;
  };
  /** Admin "import listing from link" feature. */
  listingImport: {
    /** Scraping-proxy URL template containing `{url}` (the encoded target).
     *  Unset = direct fetches only, which the big portals usually block. */
    proxyUrlTemplate?: string;
    /** Model id for AI field extraction; unset = service default. */
    aiModel?: string;
  };
}

export function getConfig(app: App): AppConfig {
  const envName = (app.node.tryGetContext("env") ?? "dev") as "dev" | "prod";
  if (envName !== "dev" && envName !== "prod") {
    throw new Error(`Unknown env "${envName}". Use -c env=dev or -c env=prod.`);
  }
  const all = app.node.tryGetContext("environments") as Record<string, unknown>;
  const raw = (all?.[envName] ?? {}) as {
    region?: string;
    logRetentionDays?: number;
    removalPolicy?: string;
    enableWaf?: boolean;
    alarmEmail?: string;
    domain?: DomainConfig | null;
    notify?: {
      mailFrom?: string;
      adminEmail?: string;
      customerUrl?: string;
      adminUrl?: string;
    };
    listingImport?: { proxyUrlTemplate?: string; aiModel?: string };
  };
  return {
    envName,
    region: raw.region ?? "eu-central-1",
    logRetentionDays: raw.logRetentionDays ?? 30,
    removalPolicy:
      raw.removalPolicy === "retain" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    enableWaf: raw.enableWaf ?? envName === "prod",
    alarmEmail: raw.alarmEmail || undefined,
    domain: raw.domain ?? undefined,
    devOrigins: ["http://localhost:5173", "http://localhost:5174"],
    notify: raw.notify ?? {},
    listingImport: {
      proxyUrlTemplate: raw.listingImport?.proxyUrlTemplate || undefined,
      aiModel: raw.listingImport?.aiModel || undefined
    }
  };
}

export function stackName(config: AppConfig, name: string): string {
  return `JJ-${config.envName}-${name}`;
}
