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
 */

const PLACEHOLDER_PREFIX = '{"placeholder"';
const cache = new Map<string, string | null>();
let client: SecretsManagerClient | undefined;

/** Value of the secret whose ARN is in `process.env[envName]`, or null when
 *  the env var is unset, the secret still holds the placeholder, or it
 *  cannot be read. */
export async function readSecretFromEnv(envName: string): Promise<string | null> {
  const arn = process.env[envName];
  if (!arn) return null;
  const hit = cache.get(arn);
  if (hit !== undefined) return hit;
  let value: string | null = null;
  try {
    client ??= new SecretsManagerClient({});
    const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
    const raw = res.SecretString?.trim() ?? "";
    value = raw && !raw.startsWith(PLACEHOLDER_PREFIX) ? raw : null;
  } catch (err) {
    logger.warn("secret unavailable", { env: envName, error: (err as Error).message });
  }
  cache.set(arn, value);
  return value;
}

/** Forget cached values (tests, rotation within a warm container). */
export function resetSecretCache(): void {
  cache.clear();
}
