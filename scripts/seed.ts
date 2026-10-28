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

interface SeedPhoto {
  /** Index into the listings array… */
  listingRef?: number;
  /** …or the prototype's original listing store id. */
  listingId?: string;
  kind?: "photo" | "floorplan";
  /** data: URL (data:image/jpeg;base64,…) or bare base64 (assumed JPEG). */
  data: string;
}

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
  photos?: SeedPhoto[];
  ratings?: unknown[];
  comments?: unknown[];
}

/* ---------- normalization: accept the original prototype's native export ----------
 * The prototype stored several fields differently: must/nice/no and pros/cons
 * as newline strings, brief.sqm/rooms instead of minSqm/minBeds, hours.cat
 * instead of category, listing references by store id instead of array index,
 * offset-less viewing timestamps, and "" for unknown balcony. Normalize all of
 * that so an export can be imported as-is. */

const toLines = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map(String).filter(Boolean)
    : typeof v === "string"
      ? v.split("\n").map((s) => s.trim()).filter(Boolean)
      : [];

function normalizeBrief(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    budget: raw.budget ?? 0,
    minSqm: raw.minSqm ?? raw.sqm ?? 0,
    minBeds: raw.minBeds ?? raw.rooms ?? 0,
    districts: raw.districts ?? [],
    ortsteile: raw.ortsteile ?? [],
    timeline: raw.timeline ?? "",
    must: toLines(raw.must),
    nice: toLines(raw.nice),
    no: toLines(raw.no),
    notes: String(raw.notes ?? "")
  };
}

function toIsoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const LISTING_STATUSES = ["new", "short", "viewing", "viewed", "offer", "passed"];
const CONTACT_STATUSES = [
  "none", "contacted", "requested", "confirmed", "viewed", "noreply", "declined"
];

function normalizeListing(raw: Record<string, unknown>): Record<string, unknown> {
  const balcony = raw.balcony === "yes" || raw.balcony === "no" ? raw.balcony : "unknown";
  const remodel = raw.remodel as Record<string, unknown> | null | undefined;
  return {
    ...raw,
    // The prototype left these null/absent until first touched.
    status: LISTING_STATUSES.includes(raw.status as string) ? raw.status : "new",
    contact: CONTACT_STATUSES.includes(raw.contact as string) ? raw.contact : "none",
    url: typeof raw.url === "string" && /^https?:/.test(raw.url) ? raw.url : null,
    ortsteil: raw.ortsteil || null,
    kiez: raw.kiez || null,
    balcony,
    balconyNote: raw.balconyNote || null,
    floor: raw.floor ? String(raw.floor) : null,
    year: raw.year ? String(raw.year) : null,
    pros: toLines(raw.pros),
    cons: toLines(raw.cons),
    notes: String(raw.notes ?? ""),
    vComment: String(raw.vComment ?? ""),
    jjNotes: String(raw.jjNotes ?? ""),
    jjComments: String(raw.jjComments ?? ""),
    viewingAt: toIsoOrNull(raw.viewingAt),
    topRank: typeof raw.topRank === "number" ? raw.topRank : 0,
    // Seeding a client board implies visibility unless the export says otherwise.
    published: raw.published ?? true,
    remodel: remodel
      ? {
          none: Boolean(remodel.none),
          items: Array.isArray(remodel.items) ? remodel.items : [],
          cost: typeof remodel.cost === "number" && remodel.cost > 0 ? remodel.cost : null,
          comment: String(remodel.comment ?? "")
        }
      : null,
    createdAt: undefined,
    updatedAt: undefined,
    id: undefined,
    score: undefined
  };
}

/** hours may reference listings by array index (listingRef) or by the
 *  prototype's store id (listingId) — map ids to indexes via listings[].id. */
function normalizeHours(
  raw: Record<string, unknown>[],
  originalListings: Record<string, unknown>[]
): SeedFile["hours"] {
  const idToIndex = new Map<string, number>();
  originalListings.forEach((l, i) => {
    if (typeof l.id === "string") idToIndex.set(l.id, i);
  });
  return raw.map((h) => ({
    date: String(h.date ?? "").slice(0, 10),
    minutes: Number(h.minutes ?? 0),
    category: String(h.category ?? h.cat ?? "Other"),
    note: String(h.note ?? ""),
    paid: Boolean(h.paid),
    listingRef:
      typeof h.listingRef === "number"
        ? h.listingRef
        : typeof h.listingId === "string"
          ? idToIndex.get(h.listingId)
          : undefined
  }));
}

function decodeImage(data: string): { bytes: Buffer; contentType: string } | null {
  const m = data.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s);
  try {
    if (m) return { contentType: m[1]!, bytes: Buffer.from(m[2]!, "base64") };
    return { contentType: "image/jpeg", bytes: Buffer.from(data, "base64") };
  } catch {
    return null;
  }
}

/** Every occurrence of --photos <file>; each file holds SeedPhoto[]. */
function photoFiles(): string[] {
  const files: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === "--photos" && process.argv[i + 1]) files.push(process.argv[i + 1]!);
  });
  return files;
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
  const originalListings = seed.listings;
  const storeIdToIndex = new Map<string, number>();
  originalListings.forEach((l, i) => {
    if (typeof l.id === "string") storeIdToIndex.set(l.id, i);
  });

  const settings = (seed.search?.settings ?? {}) as Record<string, unknown>;
  const clientName =
    seed.search?.clientName ?? (settings.client as string | undefined) ?? "Client";
  console.log(`Creating search for ${clientName}…`);
  const search = await api<{ id: string }>(
    "/admin/searches",
    "POST",
    searchCreateSchema.parse({ clientName, settings })
  );

  console.log("Saving the brief…");
  const brief: Brief = briefSchema.parse(
    normalizeBrief((seed.brief ?? {}) as Record<string, unknown>)
  );
  await api(`/admin/searches/${search.id}/brief`, "PUT", brief);

  // Validate every listing up front so one bad field can't half-seed the board.
  const parsed: { index: number; body: ListingCreateInput }[] = [];
  const invalid: string[] = [];
  seed.listings.forEach((raw, index) => {
    const result = listingCreateSchema.safeParse(normalizeListing(raw));
    if (result.success) {
      parsed.push({ index, body: result.data });
    } else {
      const title = (raw as { title?: string }).title ?? `#${index + 1}`;
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      invalid.push(`  ✗ listing ${index + 1} "${title}" — ${issues}`);
    }
  });
  if (invalid.length) {
    console.error(`\n${invalid.length} listing(s) failed validation:`);
    for (const line of invalid) console.error(line);
    console.error("Fix the seed file and re-run. Nothing was created.\n");
    process.exit(1);
  }

  console.log(`Creating ${parsed.length} listings…`);
  const listingIds: string[] = [];
  const failed: string[] = [];
  for (const { index, body } of parsed) {
    try {
      const created = await api<{ id: string; title: string }>(
        "/admin/listings",
        "POST",
        body
      );
      // Pin visibility: imported listings are explicitly shared with the
      // created search (matching also applies, but a share never surprises).
      await api(`/admin/searches/${search.id}/shares/${created.id}`, "PUT", {
        mode: "shared"
      });
      listingIds[index] = created.id;
      console.log(`  · ${created.title}`);
    } catch (err) {
      failed.push(
        `  ✗ "${body.title}" — ${err instanceof Error ? err.message : err}`
      );
    }
  }
  if (failed.length) {
    console.error(`\n${failed.length} listing(s) failed to create:`);
    for (const line of failed) console.error(line);
  }

  if (seed.sources?.length) {
    console.log(`Adding ${seed.sources.length} inbox links…`);
    await api("/admin/inbox", "POST", {
      urls: seed.sources.map((s) => s.url)
    });
  }

  const hours =
    normalizeHours(
      (seed.hours ?? []) as unknown as Record<string, unknown>[],
      originalListings
    ) ?? [];
  let hoursOk = 0;
  for (const [i, h] of hours.entries()) {
    try {
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
      hoursOk++;
    } catch (err) {
      console.error(
        `  ✗ hours entry ${i + 1} (${h.date}, ${h.minutes}m): ${err instanceof Error ? err.message : err}`
      );
    }
  }
  console.log(`Logged ${hoursOk}/${hours.length} hours entries.`);

  /* ---------- photos (from the main file and/or --photos files) ---------- */
  const photos: SeedPhoto[] = [
    ...(seed.photos ?? []),
    ...photoFiles().flatMap(
      (file) => JSON.parse(readFileSync(file, "utf8")) as SeedPhoto[]
    )
  ];
  if (photos.length) {
    console.log(`Uploading ${photos.length} photo(s)…`);
    let ok = 0;
    const photoFailures: string[] = [];
    for (const [i, p] of photos.entries()) {
      const ref =
        p.listingRef ??
        (p.listingId !== undefined ? storeIdToIndex.get(p.listingId) : undefined);
      const listingId = ref !== undefined ? listingIds[ref] : undefined;
      const decoded = decodeImage(p.data);
      if (!listingId || !decoded) {
        photoFailures.push(
          `  ✗ photo ${i + 1}: ${!listingId ? `no listing for ref ${p.listingRef ?? p.listingId}` : "undecodable image data"}`
        );
        continue;
      }
      try {
        const presigned = await api<{
          photoId: string;
          uploadUrl: string;
          headers: Record<string, string>;
        }>(`/admin/listings/${listingId}/photos/presign`, "POST", {
          kind: p.kind ?? "photo",
          contentType: decoded.contentType
        });
        const put = await fetch(presigned.uploadUrl, {
          method: "PUT",
          headers: presigned.headers,
          body: new Uint8Array(decoded.bytes)
        });
        if (!put.ok) throw new Error(`S3 PUT failed (${put.status})`);
        await api(
          `/admin/listings/${listingId}/photos/${presigned.photoId}/confirm`,
          "POST"
        );
        ok++;
      } catch (err) {
        photoFailures.push(
          `  ✗ photo ${i + 1} (listing ref ${p.listingRef}): ${err instanceof Error ? err.message : err}`
        );
      }
    }
    console.log(`Uploaded ${ok}/${photos.length} photos.`);
    for (const line of photoFailures) console.error(line);
  }

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
