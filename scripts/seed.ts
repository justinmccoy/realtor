/**
 * Seeds a deployed environment through the admin API.
 *
 *   npx tsx scripts/seed.ts --env dev [--from seed/example-data.json]
 *
 * Required environment (from the stack outputs, see README):
 *   SEED_API_BASE          e.g. https://d123.cloudfront.net  (or the API URL)
 *   SEED_ADMIN_POOL_ID     admin user pool id
 *   SEED_ADMIN_CLIENT_ID   admin app client id
 *   SEED_ADMIN_EMAIL       (optional — prompted otherwise)
 *   SEED_ADMIN_PASSWORD    (optional — prompted otherwise)
 *
 * The admin pool enforces TOTP MFA, so the script prompts for the 6-digit
 * code. Ratings and comments in the seed file are client-authored content and
 * are skipped (clients create those through the customer app).
 *
 * To import the real data from the original prototype: export its data store
 * as JSON in this file's shape, save it, and pass it via --from.
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession
} from "amazon-cognito-identity-js";
import {
  API_PREFIX,
  briefSchema,
  listingCreateSchema,
  searchCreateSchema,
  type Brief,
  type ListingCreateInput
} from "@jj/shared";

interface SeedFile {
  search: { clientName: string; settings?: Record<string, number> };
  brief: Record<string, unknown>;
  listings: Record<string, unknown>[];
  sources?: { url: string }[];
  hours?: {
    date: string;
    minutes: number;
    category: string;
    note?: string;
    listingRef?: number;
    paid?: boolean;
  }[];
  ratings?: unknown[];
  comments?: unknown[];
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function signIn(
  poolId: string,
  clientId: string,
  email: string,
  password: string,
  promptCode: () => Promise<string>
): Promise<string> {
  const user = new CognitoUser({
    Username: email,
    Pool: new CognitoUserPool({ UserPoolId: poolId, ClientId: clientId })
  });
  return new Promise((resolve, reject) => {
    user.authenticateUser(
      new AuthenticationDetails({ Username: email, Password: password }),
      {
        onSuccess: (s: CognitoUserSession) =>
          resolve(s.getAccessToken().getJwtToken()),
        onFailure: reject,
        totpRequired: () => {
          void promptCode().then((code) =>
            user.sendMFACode(
              code,
              {
                onSuccess: (s: CognitoUserSession) =>
                  resolve(s.getAccessToken().getJwtToken()),
                onFailure: reject
              },
              "SOFTWARE_TOKEN_MFA"
            )
          );
        },
        newPasswordRequired: () =>
          reject(
            new Error(
              "This admin still has a temporary password. Sign in once via the admin web app first."
            )
          ),
        mfaSetup: () =>
          reject(
            new Error(
              "This admin has not set up TOTP yet. Sign in once via the admin web app first."
            )
          )
      }
    );
  });
}

async function main(): Promise<void> {
  const from = arg("from", "seed/example-data.json")!;
  const envName = arg("env", "dev");
  const apiBase = process.env.SEED_API_BASE;
  const poolId = process.env.SEED_ADMIN_POOL_ID;
  const clientId = process.env.SEED_ADMIN_CLIENT_ID;
  if (!apiBase || !poolId || !clientId) {
    console.error(
      "Set SEED_API_BASE, SEED_ADMIN_POOL_ID and SEED_ADMIN_CLIENT_ID (see README → Seeding)."
    );
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email =
    process.env.SEED_ADMIN_EMAIL ?? (await rl.question("Admin email: "));
  const password =
    process.env.SEED_ADMIN_PASSWORD ?? (await rl.question("Admin password: "));

  console.log(`Signing in to ${envName}…`);
  const token = await signIn(poolId, clientId, email.trim(), password, () =>
    rl.question("TOTP code: ").then((c) => c.trim())
  );
  rl.close();

  const api = async <T>(path: string, method: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${apiBase}${API_PREFIX}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data: unknown = res.status === 204 ? undefined : await res.json();
    if (!res.ok) {
      throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
    }
    return data as T;
  };

  const seed = JSON.parse(readFileSync(from, "utf8")) as SeedFile;

  console.log(`Creating search for ${seed.search.clientName}…`);
  const search = await api<{ id: string }>(
    "/admin/searches",
    "POST",
    searchCreateSchema.parse(seed.search)
  );

  console.log("Saving the brief…");
  const brief: Brief = briefSchema.parse(seed.brief);
  await api(`/admin/searches/${search.id}/brief`, "PUT", brief);

  console.log(`Creating ${seed.listings.length} listings…`);
  const listingIds: string[] = [];
  for (const raw of seed.listings) {
    const body: ListingCreateInput = listingCreateSchema.parse(raw);
    const created = await api<{ id: string; title: string }>(
      `/admin/searches/${search.id}/listings`,
      "POST",
      body
    );
    listingIds.push(created.id);
    console.log(`  · ${created.title}`);
  }

  if (seed.sources?.length) {
    console.log(`Adding ${seed.sources.length} inbox links…`);
    await api(`/admin/searches/${search.id}/inbox`, "POST", {
      urls: seed.sources.map((s) => s.url)
    });
  }

  for (const h of seed.hours ?? []) {
    const entry = await api<{ id: string }>(
      `/admin/searches/${search.id}/hours`,
      "POST",
      {
        date: h.date,
        minutes: h.minutes,
        category: h.category,
        listingId: h.listingRef != null ? (listingIds[h.listingRef] ?? null) : null,
        note: h.note ?? ""
      }
    );
    if (h.paid) {
      await api(`/admin/searches/${search.id}/hours/${entry.id}`, "PUT", {
        paid: true
      });
    }
  }
  console.log(`Logged ${(seed.hours ?? []).length} hours entries.`);

  const skipped = (seed.ratings?.length ?? 0) + (seed.comments?.length ?? 0);
  if (skipped) {
    console.log(
      `Skipped ${skipped} ratings/comments — client-authored content is created through the customer app.`
    );
  }

  console.log(`\nDone. Search id: ${search.id}`);
  console.log(
    "Next: invite the client in the admin app (Search → Members) so they can sign in."
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
