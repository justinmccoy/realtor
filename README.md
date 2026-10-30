# Genau Here

Clients review hand-picked listings, rate and discuss them, and see
the consultant's billable hours; the admin manages everything and sees how
clients interact with the site.

- **customer-web** — preserves the artifact's design 1:1 (district street-sign
  plates, Barlow type, fit chips, benchmark deltas, dark mode), backed by real
  APIs, plus login/registration and an interaction-tracking beacon.
- **admin-web** — searches/clients, listings with publish control, photos,
  link inbox, hours + timer, ratings/comments moderation, per-listing
  engagement analytics, activity feed, permanent audit log.

## Architecture

Serverless on AWS (eu-central-1), one `cdk deploy` for everything:

| Layer | Service |
|---|---|
| Frontends | 2× private S3 + CloudFront (WAF in prod), `/api/*` forwarded same-origin |
| Auth | Cognito: customer pool (self-register, invite-gated content) + admin pool (no self-signup, TOTP MFA required) |
| API | API Gateway HTTP API under `/api/v1`, admin JWT authorizer + customer Lambda authorizer (resolves search memberships) |
| Compute | ~15 Lambdas (Node 22/arm64), one service per bounded context |
| Data | 6 DynamoDB tables (on-demand), strict table-per-service ownership |
| Events | EventBridge bus; the activity service consumes everything (audit + feed); media/engagement keep event-carried listing state |
| Media | Private S3 bucket, pre-signed PUT uploads / GET downloads |
| Observability | Structured logs, X-Ray, per-function alarms → SNS, DLQ on the audit consumer |

Services: **search** (searches, brief, settings, members/invites),
**listings** (pipeline, benchmark/top-5, inbox), **media** (photos/floor
plans), **engagement** (ratings, threaded comments), **timesheet** (hours,
timer, paid tracking), **activity** (audit log, client activity feed,
engagement rollups).

Deviations from a "classic" blueprint, deliberately: DynamoDB instead of
Aurora (≈$2/mo vs ≈$60/mo idle at this scale), WAF on CloudFront only (WAF
cannot attach to HTTP APIs), costs computed client-side from shared helpers
(as the artifact did).

## Repository layout

```
packages/shared        zod schemas, Berlin districts, cost math, event contracts
packages/lambda-kit    Lambda middleware: validation, auth context, errors, events
services/<name>        one deployable service each: src/handlers, src/repo, tests
apps/customer-web      Vite + React client app (artifact design)
apps/admin-web         Vite + React admin app
infra                  AWS CDK (TypeScript), 12 stacks, dev/prod parameterized
seed/                  example content + import format
scripts/               seed.ts, deploy-frontends.sh
.github/workflows      ci.yml (verify) + deploy.yml (dev → approval → prod)
```

## Prerequisites

- Node 22+ (`.nvmrc`), pnpm 9 (`npm i -g pnpm` or use `npx pnpm@9`)
- Docker (for DynamoDB Local in integration tests — optional: tests fall back
  to an in-process emulator)
- AWS CLI v2 + an AWS account; AWS CDK bootstrapped (see below)

## Local development

```bash
pnpm install
docker compose up -d        # DynamoDB Local :8000, LocalStack :4566 (optional)

pnpm lint
pnpm -r typecheck
pnpm -r test                                 # unit tests
pnpm -r --if-present run test:integration    # DynamoDB-backed tests
# (DDB_ENDPOINT=http://localhost:8000 to use the Docker container;
#  without it an in-process emulator is used)
```

Run the frontends against a **deployed dev environment** (Cognito can't be
faithfully emulated locally):

```bash
# values from the JJ-dev-Auth stack outputs
cat > apps/customer-web/.env.local <<EOF
VITE_API_BASE=https://<dev-customer-cloudfront-domain>
VITE_CUSTOMER_POOL_ID=eu-central-1_xxx
VITE_CUSTOMER_CLIENT_ID=xxxx
EOF
pnpm --filter @jj/customer-web dev    # http://localhost:5173

cat > apps/admin-web/.env.local <<EOF
VITE_API_BASE=https://<dev-admin-cloudfront-domain>
VITE_ADMIN_POOL_ID=eu-central-1_yyy
VITE_ADMIN_CLIENT_ID=yyyy
EOF
pnpm --filter @jj/admin-web dev       # http://localhost:5174
```

(Dev API CORS already allows both localhost origins. Alternatively set
`VITE_API_PROXY=<cloudfront url>` to proxy `/api` through Vite.)

## Listing import (admin → Link inbox)

**Import** next to an inbox link fetches the portal page, parses it (JSON-LD,
meta tags, the German key/value table: Kaufpreis, Wohnfläche, Zimmer, Etage,
Baujahr, Hausgeld, Provision, Balkon, Bezirk/Ortsteil from the address) and,
when configured, asks the AI model to fill whatever the parser missed. A
hidden draft listing is created, the photos found on the page are downloaded
into the media bucket, and the editor opens on the draft with every
auto-filled field marked for review. **Manual** keeps the old behaviour (an
empty form with just the link). When a portal blocks the request the link is
marked *Blocked* and **Paste text** imports from the page text copied out of
your browser (also reachable via "Import from pasted text").

Configuration, per environment:

| What | Where | Default |
|---|---|---|
| AI extraction key | Secrets Manager secret `jj/<env>/listing-import/ai-api-key` (created by the Listing stack with a placeholder) | AI off until a real key is stored |
| AI model | `infra/cdk.json` → `environments.<env>.listingImport.aiModel` | `DEFAULT_AI_MODEL` in `services/listings/src/import/ai.ts` |
| Fetch proxy | `environments.<env>.listingImport.proxyUrlTemplate`, a scraping-API URL with `{url}` for the encoded target and `{key}` for the API key, e.g. `https://app.scrapingbee.com/api/v1/?api_key={key}&render_js=true&url={url}` | none → direct fetch only |
| Fetch proxy API key | Secrets Manager secret `jj/<env>/listing-import/proxy-api-key` (created by the Listing stack with a placeholder) | proxy stays off until stored |

```bash
aws secretsmanager put-secret-value \
  --secret-id jj/dev/listing-import/ai-api-key --secret-string "sk-ant-…"
aws secretsmanager put-secret-value \
  --secret-id jj/dev/listing-import/proxy-api-key --secret-string "<provider key>"
```

The proxy key is never written to `cdk.json` or a Lambda environment
variable: the template carries `{key}` and the importer fills it in from the
secret at runtime. If the template is set but the secret still holds its
placeholder, imports fall back to direct fetches and the Blocked message says
the proxy key is missing.

Notes: ImmobilienScout24 and Kleinanzeigen usually refuse requests from cloud
IP ranges; a scraping proxy or the paste fallback covers them. Up to 15 photos
are pulled per import (6 per request, 8 MB each, JPEG/PNG/WebP); more can be
uploaded by hand. API Gateway caps a request at 30 s, so an import is two
requests: `import/fetch` gets the page (the proxy alone gets up to ~27 s for
portals known to block cloud IPs, which skip the direct attempt), then
`import` extracts fields, calls the AI model and creates the draft from that
HTML. A slow or failed AI call degrades to "page markup only" rather than
failing the import; a proxy timeout reports itself and can simply be retried.

## First-time deployment

```bash
# one-time per account/region (also us-east-1 for the CloudFront WAF/certs)
pnpm --filter @jj/infra exec cdk bootstrap aws://<ACCOUNT>/eu-central-1
pnpm --filter @jj/infra exec cdk bootstrap aws://<ACCOUNT>/us-east-1

pnpm install
pnpm deploy:dev        # ≈10–15 min first time (CloudFront)
./scripts/deploy-frontends.sh dev
```

The stack outputs print the CloudFront URLs, pool ids and table names.
Custom domains: fill in `context.environments.prod.domain` in `infra/cdk.json`
(`zoneName`, `customer`, `admin`) — Route53 records and ACM certs are created
automatically.

### Create the first admin

```bash
POOL_ID=$(aws cloudformation describe-stacks --stack-name JJ-dev-Auth \
  --query "Stacks[0].Outputs[?OutputKey=='AdminPoolId'].OutputValue" --output text)

aws cognito-idp admin-create-user --user-pool-id "$POOL_ID" \
  --username you@example.com \
  --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true Name=name,Value="JJ"

aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL_ID" \
  --username you@example.com --group-name admin
```

Cognito emails a temporary password. Open the **admin** URL, sign in, set a
real password, and enrol TOTP (the login screen shows the secret for your
authenticator app). Without the `admin` group, every API call returns 403.

### Seed data

```bash
export SEED_API_BASE=https://<customer-or-admin-cloudfront-url>
export SEED_ADMIN_POOL_ID=$POOL_ID
export SEED_ADMIN_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name JJ-dev-Auth \
  --query "Stacks[0].Outputs[?OutputKey=='AdminClientId'].OutputValue" --output text)
npx tsx scripts/seed.ts --env dev                       # example Berlin content
npx tsx scripts/seed.ts --env dev --from seed/private-export.json   # real data
```

To import the real data from the original prototype: export its data store
(listings, hours, brief, settings) as JSON in the shape of
`seed/example-data.json` and save it as `seed/private-export.json`
(gitignored).

Then invite the client in the admin app (Search → Members) — Cognito emails
them a temporary password for the **customer** site. Clients with the
`client` role can then invite more people themselves from the user menu
("Invite someone…"), with edit (`client`) or view-only (`viewer`) access.

## CI/CD (GitHub Actions)

1. Push this repo to GitHub.
2. Create an IAM role for GitHub OIDC (trust `token.actions.githubusercontent.com`,
   condition on your repo) with permissions to deploy CDK (CloudFormation,
   plus the `cdk-*` bootstrap roles) and `s3 sync`/`cloudfront
   create-invalidation`; save its ARN as the repo secret **`AWS_DEPLOY_ROLE_ARN`**.
3. Create GitHub environments `dev` and `production`; add **required
   reviewers** on `production` — that is the manual approval gate before prod.

Every PR runs `ci.yml` (lint, typecheck, unit + integration tests against a
DynamoDB Local service container, frontend builds, cdk synth). Pushes to
`main` run `deploy.yml`: verify → deploy dev (infra + migrations + frontends +
cache invalidation) → **manual approval** → deploy prod.

## Tear-down

```bash
pnpm --filter @jj/infra exec cdk destroy -c env=dev --all
```

Dev resources delete cleanly (buckets auto-empty). In prod, tables/buckets/
pools are retained by default (`removalPolicy: retain`) — empty and delete
them manually, deliberately. Finally remove the two CDK bootstrap stacks if
the account is otherwise unused.

## Monthly cost (low traffic)

| Item | dev | prod | notes |
|---|---|---|---|
| Lambda + API Gateway + EventBridge | ~$0 | <$1 | well inside free/near-free tiers at this volume |
| DynamoDB (on-demand, 6 tables) | <$1 | <$1 | the Aurora alternative would be ~$60+ idle |
| S3 + CloudFront | <$1 | ~$1 | a few GB of photos |
| CloudWatch logs/alarms + X-Ray | ~$1 | ~$3 | main "background" cost; retention 30/180 days |
| Cognito | $0 | $0 | free under 10k MAU |
| **WAF (prod only)** | $0 | **~$11** | $5 ACL + 4 rule groups + requests — the biggest line |
| Route53 + certs (if custom domain) | — | ~$1 | $0.50/zone; ACM free |
| **Total** | **~$2–3** | **~$15–18** | both environments ≈ **$20/mo** |

Cost levers: WAF off (`enableWaf: false`) saves ~$11; dev can be destroyed
when idle and redeployed in minutes.

## Security notes

- Admin and customer tokens are structurally separate (different Cognito
  issuers); admin routes also require the `admin` group.
- Customers only ever receive **published** listings with admin-private fields
  stripped; cross-tenant writes are blocked via event-carried listing state.
- Every admin mutation lands in a permanent audit log (who/what/before/after).
- Client interaction tracking is first-party only, tied to signed-in members,
  with a 180-day TTL — mention it in your privacy policy (GDPR).
- No secrets in the repo: infra wires identifiers through stack outputs/env;
  Secrets Manager is available for future third-party credentials.
