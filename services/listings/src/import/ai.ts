import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  GetSecretValueCommand,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";
import { logger } from "@jj/lambda-kit";
import {
  BALCONY_STATES,
  DISTRICT_NAMES,
  extractedListingSchema,
  type ExtractableField,
  type ExtractedListing
} from "@jj/shared";
// The SDK's structured-output helper is typed against zod v4, which zod 3.25+
// ships under this subpath; the rest of the repo stays on the v3 API.
import { z } from "zod/v4";
import { canonicalOrtsteil } from "./geo.js";

/**
 * AI extraction: the page text goes to the model with a fixed output schema.
 * It is portal-agnostic and fills whatever the regex parser missed (district
 * from a postcode, floor from prose, commission from the fine print…).
 *
 * Configuration (env):
 *   ANTHROPIC_API_KEY   — key directly (local runs), or
 *   AI_SECRET_ARN       — Secrets Manager secret holding the key
 *   IMPORT_AI_MODEL     — model id (default claude-opus-5-5)
 */

export const DEFAULT_AI_MODEL = "claude-opus-5-5";
/** Keep latency inside the API Gateway budget; long pages are still sent whole
 *  up to this many characters, and the caller is told when they were cut. */
export const MAX_AI_TEXT_CHARS = 150_000;

const aiOutputSchema = z.object({
  title: z
    .string()
    .nullable()
    .describe("Short listing headline (max 120 chars) in the listing's language"),
  bezirk: z
    .enum(DISTRICT_NAMES)
    .nullable()
    .describe(
      "Berlin district (Bezirk). Infer from the postcode or Ortsteil when the page does not name it"
    ),
  ortsteil: z.string().nullable().describe("Berlin Ortsteil, e.g. Prenzlauer Berg"),
  kiez: z
    .string()
    .nullable()
    .describe("Street with house number if given, otherwise the neighbourhood (Kiez)"),
  price: z.number().nullable().describe("Purchase price (Kaufpreis) in EUR"),
  sqm: z.number().nullable().describe("Living area (Wohnfläche) in m²"),
  rooms: z
    .number()
    .nullable()
    .describe("German room count (Zimmer) including the living room; may be fractional"),
  beds: z.number().int().nullable().describe("Number of separate bedrooms, if stated"),
  baths: z.number().nullable().describe("Number of bathrooms"),
  floor: z
    .string()
    .nullable()
    .describe('Floor as short text, e.g. "3. OG von 5" or "Erdgeschoss"'),
  year: z
    .string()
    .nullable()
    .describe('Year built, plus a short modernisation note if stated, e.g. "1908, saniert 2015"'),
  hausgeld: z.number().nullable().describe("Monthly service charge (Hausgeld) in EUR"),
  provision: z
    .number()
    .nullable()
    .describe("Buyer's commission in percent; 0 when commission-free; null when not stated"),
  balcony: z.enum(BALCONY_STATES).describe("Whether there is a balcony, loggia or terrace"),
  balconyNote: z.string().nullable().describe("Balcony/terrace details: orientation, size"),
  notes: z
    .string()
    .nullable()
    .describe(
      "Other facts worth keeping that no field covers: condition, heating, energy class, lift, cellar, parking, rental status, availability, Hausgeld breakdown. Plain text, max 1200 chars, same language as the listing"
    )
});

const SYSTEM = `You extract structured data for a Berlin apartment purchase listing (Eigentumswohnung) from the text of a property portal page.
Rules:
- Use only facts stated in the page text. Use null for anything not stated. Never guess numbers.
- Numbers are plain numbers: EUR without separators for prices, m² for areas, percent for commission.
- "bezirk" must be one of Berlin's 12 districts; derive it from the postcode or Ortsteil when the page only gives those. Berlin postcodes run 10115–14199.
- Pages often also list other properties ("Ähnliche Objekte", adverts, agent portfolios). Describe only the main listing — the one presented first and in the most detail.
- Keep text fields short and factual.`;

let cachedKey: string | null | undefined;

async function resolveApiKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;
  const direct = process.env.ANTHROPIC_API_KEY?.trim();
  if (direct) {
    cachedKey = direct;
    return cachedKey;
  }
  const arn = process.env.AI_SECRET_ARN;
  if (!arn) {
    cachedKey = null;
    return cachedKey;
  }
  try {
    const res = await new SecretsManagerClient({}).send(
      new GetSecretValueCommand({ SecretId: arn })
    );
    const value = res.SecretString?.trim() ?? "";
    // The stack creates the secret with a random placeholder until the admin
    // stores a real key; only real keys start with this prefix.
    cachedKey = value.startsWith("sk-ant-") ? value : null;
  } catch (err) {
    logger.warn("ai secret unavailable", { error: (err as Error).message });
    cachedKey = null;
  }
  return cachedKey;
}

/** Forget the cached key (tests, key rotation within a warm container). */
export function resetAiKeyCache(): void {
  cachedKey = undefined;
}

export async function aiConfigured(): Promise<boolean> {
  return (await resolveApiKey()) !== null;
}

export interface AiExtractInput {
  text: string;
  url?: string;
  timeoutMs: number;
}

export interface AiExtractResult {
  fields: ExtractedListing;
  model: string;
  truncated: boolean;
  /** Set when the model declined or returned nothing usable. */
  problem?: string;
}

export async function extractWithAi(input: AiExtractInput): Promise<AiExtractResult | null> {
  const apiKey = await resolveApiKey();
  if (!apiKey) return null;
  const model = process.env.IMPORT_AI_MODEL?.trim() || DEFAULT_AI_MODEL;
  const truncated = input.text.length > MAX_AI_TEXT_CHARS;
  const text = truncated ? input.text.slice(0, MAX_AI_TEXT_CHARS) : input.text;

  const client = new Anthropic({ apiKey, timeout: input.timeoutMs, maxRetries: 0 });
  const response = await client.messages.parse({
    model,
    max_tokens: 4096,
    system: SYSTEM,
    output_config: { format: zodOutputFormat(aiOutputSchema), effort: "low" },
    messages: [
      {
        role: "user",
        content: `Source URL: ${input.url ?? "unknown"}\n\nPAGE TEXT:\n${text}`
      }
    ]
  });

  if (response.stop_reason === "refusal") {
    return { fields: {}, model, truncated, problem: "The model declined to process this page" };
  }
  const out = response.parsed_output;
  if (!out) {
    return { fields: {}, model, truncated, problem: "The model returned no structured data" };
  }

  const fields: ExtractedListing = {};
  const put = <K extends ExtractableField>(k: K, v: unknown) => {
    if (v === null || v === undefined || v === "") return;
    const parsed = extractedListingSchema.shape[k].safeParse(v);
    if (parsed.success) (fields as Record<string, unknown>)[k] = parsed.data;
  };
  put("title", out.title?.trim());
  put("bezirk", out.bezirk);
  put("ortsteil", out.ortsteil ? canonicalOrtsteil(out.ortsteil) : undefined);
  put("kiez", out.kiez?.trim());
  put("price", out.price);
  put("sqm", out.sqm);
  put("rooms", out.rooms);
  put("beds", out.beds);
  put("baths", out.baths);
  put("floor", out.floor?.trim());
  put("year", out.year?.trim());
  put("hausgeld", out.hausgeld);
  put("provision", out.provision);
  if (out.balcony !== "unknown") put("balcony", out.balcony);
  put("balconyNote", out.balconyNote?.trim());
  put("notes", out.notes?.trim());

  logger.info("ai extraction done", {
    model,
    fields: Object.keys(fields),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens
  });
  return { fields, model, truncated };
}
