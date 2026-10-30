import {
  GetSecretValueCommand,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";
import { logger } from "@jj/lambda-kit";

/**
 * Secrets Manager reads for the importer, cached per warm container.
 *
 * The stacks create each secret with a generated placeholder so the Lambda
 * can be deployed before anyone has a key. A placeholder is the JSON the
 * stack generates (`{"placeholder":true,"nonce":"…"}`); anything else is
 * treated as the real value.
 *
 * A real value is kept for the life of the container. "No value yet" is only
 * kept briefly, so storing a key takes effect within a minute instead of
 * whenever Lambda happens to recycle the container.
 */

const PLACEHOLDER_PREFIX = '{"placeholder"';
/** How long a missing/placeholder/unreadable result is trusted. */
export const MISSING_SECRET_TTL_MS = 60_000;
const cache = new Map<string, { value: string | null; until: number }>();
let client: SecretsManagerClient | undefined;

/** Value of the secret whose ARN is in `process.env[envName]`, or null when
 *  the env var is unset, the secret still holds the placeholder, or it
 *  cannot be read. */
export async function readSecretFromEnv(envName: string): Promise<string | null> {
  const arn = process.env[envName];
  if (!arn) return null;
  const hit = cache.get(arn);
  if (hit && Date.now() < hit.until) return hit.value;
  let value: string | null = null;
  try {
    client ??= new SecretsManagerClient({});
    const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
    const raw = res.SecretString?.trim() ?? "";
    value = raw && !raw.startsWith(PLACEHOLDER_PREFIX) ? raw : null;
  } catch (err) {
    logger.warn("secret unavailable", { env: envName, error: (err as Error).message });
  }
  cache.set(arn, {
    value,
    until: value === null ? Date.now() + MISSING_SECRET_TTL_MS : Number.POSITIVE_INFINITY
  });
  return value;
}

/** Forget cached values (tests, rotation within a warm container). */
export function resetSecretCache(): void {
  cache.clear();
}
