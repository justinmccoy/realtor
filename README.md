# Genau Here

A private apartment-search site for a Berlin buyer's consultant (JJ) and
her clients. Clients review hand-picked listings, rate and discuss them, and
see the consultant's billable hours; the admin manages everything and sees
how clients interact with the site.

- **customer-web** — the client site (https://genauhere.de, also
  `www.`): the original prototype's design 1:1 (district street-sign
  plates, Barlow type, fit chips, benchmark deltas, dark mode), backed by
  real APIs, plus login/registration and an interaction-tracking beacon.
- **admin-web** — the admin console (https://admin.genauhere.de):
  searches/clients, listings with publish control, link import, photos,
  hours + timer, ratings/comments moderation, per-listing engagement
  analytics, activity feed, permanent audit log.

## New here? Start with these

| If you want to… | Read |
|---|---|
| understand how the pieces fit, with diagrams and a worked example | [docs/architecture.html](docs/architecture.html) (open it in a browser) |
| set up an AWS account and deploy from scratch, step by step | [docs/runbook.html](docs/runbook.html) |
| run the code on your laptop | [Local development](#local-development) below |
| know how a listing reaches a client | [How a listing reaches a client](#how-a-listing-reaches-a-client) below |
| take the site to production on your own domain | [Going to production](#going-to-production) below |

A few words you will meet everywhere:

- **Search** — one client engagement ("Brian's search"). It is the tenancy
  unit: members, brief, settings, comments and hours all hang off a search.
- **Brief / settings** — what the client is looking for (districts, budget,
  rooms…) and the cost assumptions (tax, notary, commission). Together they
  decide which listings a search sees.
- **Listing** — one apartment. Listings are global, not per search: JJ
  curates one pool, and each search sees the published ones that match its
  brief, plus anything JJ shared by hand, minus anything she hid.
- **Member** — a person on a search: `client` (can rate, comment, invite)
  or `viewer` (read-only).
- **Admin** — JJ. A separate login with mandatory MFA.

## Architecture

Serverless on AWS (eu-central-1), one `cdk deploy` for everything. There is
no server to look after; at rest the whole thing costs a few dollars a month.

| Layer | Service |
|---|---|
| Frontends | 2× private S3 + CloudFront (WAF in prod), `/api/*` forwarded same-origin; custom domains via Route53 + ACM when configured |
| Auth | Cognito: customer pool (self-register or invited, invite-gated content) + admin pool (no self-signup, TOTP MFA required) |
| API | API Gateway HTTP API under `/api/v1`, admin JWT authorizer + customer Lambda authorizer (resolves search memberships) |
| Compute | 20 Lambdas (Node 22/arm64): one admin + one customer function per service, event consumers, the customer authorizer, the import API + its worker, and the notifier |
| Data | 6 DynamoDB tables (on-demand), strict table-per-service ownership |
| Events | EventBridge bus; the activity service consumes everything (audit + feed); media/engagement keep event-carried listing state; listings keeps event-carried search criteria; the import worker is triggered by an event |
| Media | Private S3 bucket, pre-signed PUT uploads / GET downloads, photo import from URLs |
| Email | Cognito's built-in mailer for invitations and password resets; SES (optional) for activity notifications |
| Secrets | Secrets Manager for third-party keys (AI extraction, scraping proxy), read at runtime |
| Observability | Structured logs, X-Ray, per-function alarms → SNS, DLQ on the audit consumer |

Services, each with its own table and Lambdas: **search** (searches,
brief, settings, members/invites, notifications), **listings** (global
pool, per-search visibility, pipeline, benchmark/top-5, link inbox and
import), **media** (photos/floor plans), **engagement** (ratings, threaded
comments), **timesheet** (hours, timer, paid tracking), **activity** (audit
log, client activity feed, engagement rollups).

Deviations from a "classic" blueprint, deliberately: DynamoDB instead of
Aurora (≈$2/mo vs ≈$60/mo idle at this scale), WAF on CloudFront only (WAF
cannot attach to HTTP APIs), costs computed client-side from shared helpers
(as the prototype did).

## How a listing reaches a client

1. **JJ adds a listing** in the admin app: either by hand, or by pasting a
   portal link into the **Link inbox** and clicking **Import**, which fetches
   the page, extracts the facts (with AI, in English) and creates a draft.
   See [Listing import](#listing-import-admin--link-inbox).
2. **She reviews the draft** — every auto-filled field is marked — adds
   photos, and **publishes** it. Drafts are never visible to clients.
3. **Each search decides what it sees.** The listing service keeps an
   event-carried copy of every search's brief and settings. A published
   listing is visible to a search when it matches that brief, or when JJ
   **shared** it with that search explicitly; a **hidden** override removes
   it. Nothing is copied per search; visibility is computed on read.
4. **The client sees it** on genauhere.de, rates it, comments, opens the
   exposé. Those interactions flow back as events, so JJ's dashboard shows
   who did what and when.

## Repository layout

```
packages/shared        zod schemas, Berlin districts, cost math, matching rule, event contracts
packages/lambda-kit    Lambda middleware: validation, auth context, errors, events, safe fetch
services/<name>        one deployable service each: src/handlers, src/repo, tests
services/listings/src/import   the link importer: fetch, parse, AI, job runner
apps/customer-web      Vite + React client app (prototype design)
apps/admin-web         Vite + React admin app
infra                  AWS CDK (TypeScript), 12 stacks, dev/prod parameterized in cdk.json
seed/                  example content + import format
scripts/               seed.ts, deploy-frontends.sh
docs/                  architecture guide + AWS runbook (static HTML, open in a browser)
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

The backend has no local run mode: services are plain Lambda handlers
exercised by unit tests (with mocked AWS clients) and DynamoDB-backed
integration tests. Real behaviour is checked on the dev environment.

## Listing import (admin → Link inbox)

**Import** next to an inbox link fetches the portal page, parses it (JSON-LD,
meta tags, the German key/value table: Kaufpreis, Wohnfläche, Zimmer, Etage,
Baujahr, Hausgeld, Provision, Balkon, Bezirk/Ortsteil from the address) and,
when configured, asks the AI model to fill whatever the parser missed and to
write every text field (title, floor, year, balcony and notes) in English,
translating the German page. Without the AI key those fields stay as the
portal wrote them. A hidden draft listing is created, the photos found on the
page are downloaded into the media bucket, and the editor opens on the draft
with every auto-filled field marked for review. **Manual** keeps the old
behaviour (an empty form with just the link). When a portal blocks the
request the link is marked *Blocked* and **Paste text** imports from the page
text copied out of your browser (also reachable via "Import from pasted
text").

### How it runs

A link import is a **background job**, because fetching through a rendering
proxy plus the AI call takes longer than API Gateway's 30-second request
limit:

1. `POST /api/v1/admin/import` stores a job and publishes
   `listing.import.requested`; it answers `202` with the job at once.
2. The **import worker** Lambda (two-minute budget) picks the job up from
   the bus, fetches the page (directly, or straight through the proxy for
   portals known to block cloud IPs), parses it, calls the AI, creates the
   draft, and records progress (`fetching` → `extracting` → `saving`) and the
   result on the job.
3. The admin app polls `GET /api/v1/admin/import/{jobId}` every 1.5 s and
   shows a house being built, one stage per step; then it imports the photos
   in batches of 6 and opens the editor.

Page fetch, proxy fallback and AI call each have their own timeout
(`IMPORT_BUDGETS` in `services/listings/src/import/index.ts`: 10 s direct,
30 s proxy, 60 s AI). A slow or failed AI call degrades to "page markup
only" rather than failing the import; a job that overruns is marked failed
with a `timeout` error and can simply be retried. Pasted text is read inline
(≈25 s budget), since it only needs the AI call. Jobs expire from the table
after a day. Up to 15 photos are pulled per import (8 MB each,
JPEG/PNG/WebP); more can be uploaded by hand.

### Configuration, per environment

| What | Where | Default |
|---|---|---|
| AI extraction key | Secrets Manager secret `jj/<env>/listing-import/ai-api-key` (created by the Listing stack with a placeholder) | AI off until a real `sk-ant-…` key is stored |
| AI model | `infra/cdk.json` → `environments.<env>.listingImport.aiModel` | `claude-opus-5-5` (`DEFAULT_AI_MODEL` in `services/listings/src/import/ai.ts`) |
| Fetch proxy | `environments.<env>.listingImport.proxyUrlTemplate`, a scraping-API URL with `{url}` for the encoded target and `{key}` for the API key | none → direct fetch only |
| Fetch proxy API key | Secrets Manager secret `jj/<env>/listing-import/proxy-api-key` (created by the Listing stack with a placeholder) | proxy stays off until stored |

Both dev and prod are set up for ScrapingBee with JavaScript rendering and
German residential proxies:
`https://app.scrapingbee.com/api/v1/?api_key={key}&render_js=true&premium_proxy=true&country_code=de&url={url}`.

Get the AI key from the Claude Console (https://console.anthropic.com →
API Keys → Create Key; the account needs billing set up) and the proxy key
from your ScrapingBee dashboard, then store them — once per environment:

```bash
aws secretsmanager put-secret-value \
  --secret-id jj/prod/listing-import/ai-api-key --secret-string "sk-ant-…"
aws secretsmanager put-secret-value \
  --secret-id jj/prod/listing-import/proxy-api-key --secret-string "<ScrapingBee key>"
```

Keys are never written to `cdk.json`, a Lambda environment variable or the
repo: the Lambdas read the secrets at runtime and notice a newly stored key
within a minute, no redeploy needed. If the proxy template is set but the
secret still holds its placeholder, imports fall back to direct fetches and
the Blocked message says the proxy key is missing. ImmobilienScout24 and
Kleinanzeigen refuse requests from cloud IP ranges, so without the proxy
those two only work via the paste fallback.

## Accounts, invitations and email

**Admins** are created from the CLI (see [Create the first admin](#create-the-first-admin)),
never from the site. They sign in with email + password + an authenticator
app. **Clients** are invited from the admin app (Search → Members) and get
an email with a temporary password for the customer site; clients with the
`client` role can invite further people from their user menu, with edit
(`client`) or view-only (`viewer`) access. Anyone can also self-register on
the customer site, but sees nothing until invited to a search.

What inviting an address does, and what the app tells you:

| Situation | What happens |
|---|---|
| New address | Cognito account created, invitation email sent ("Invitation sent") |
| Invited before, never signed in | Invitation sent again with a fresh temporary password ("a fresh temporary password has been emailed") |
| Already has a working account | Given access to the search, no email ("Added to the search") |

Good to know:

- A temporary password is valid for **7 days**. After that, invite the
  person again; the app re-sends automatically.
- **"Forgot password" does not work for someone who has never signed in.**
  Cognito refuses to reset an account that is still on its temporary
  password, and because the customer app hides whether an account exists,
  the person is told a code was sent when nothing was. Re-invite them
  instead.
- Invitation and reset emails come from Cognito's built-in mailer
  (`no-reply@verificationemail.com`), which is capped at **50 emails a day**
  and often lands in spam. Fine while there are a handful of clients; set
  `notify.mailFrom` to a verified SES identity before real volume.
- The email wording lives in `infra/lib/auth-stack.ts`. The temporary
  password and reset code each sit at the end of their own line so a
  trailing full stop can't be mistaken for part of the value.
- Clients can be re-invited to another search any time; the account is
  shared across searches.

## First-time deployment

```bash
# one-time per account/region (also us-east-1 for the CloudFront WAF/certs)
pnpm --filter @jj/infra exec cdk bootstrap aws://<ACCOUNT>/eu-central-1
pnpm --filter @jj/infra exec cdk bootstrap aws://<ACCOUNT>/us-east-1

pnpm install
pnpm deploy:dev        # ≈10–15 min first time (CloudFront)
./scripts/deploy-frontends.sh dev
```

The stack outputs print the CloudFront URLs, pool ids and table names. The
runbook in `docs/runbook.html` walks through all of this from a blank AWS
account, including the CI/CD role.

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
Prod has its own pool: repeat with `--stack-name JJ-prod-Auth`.

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

Then invite the client in the admin app (Search → Members).

## Going to production

Prod is the same stacks under `JJ-prod-*`, created the first time you
approve the production step of the Deploy workflow. Then, in this order:

1. **Custom domains.** Create a public hosted zone in Route53 for your
   domain and delegate the domain to its four nameservers at your registrar
   (wait until `dig NS <domain>` shows `awsdns` names). Only then fill in
   `infra/cdk.json` → `environments.prod`:
   ```json
   "domain": {
     "zoneName": "genauhere.de",
     "customer": "genauhere.de",
     "customerAliases": ["www.genauhere.de"],
     "admin": "admin.genauhere.de"
   },
   "notify": { "customerUrl": "https://genauhere.de", "adminUrl": "https://admin.genauhere.de", ... }
   ```
   The deploy issues the ACM certificates (validated through the zone),
   attaches the names to both CloudFront distributions, creates the A
   records, adds the origins to API CORS and points Cognito's emails at the
   new URLs. Allow 20–30 minutes. The zone must exist before the deploy:
   the Edge stack looks it up at synth time and a missing zone blocks the
   whole prod deploy. `customerAliases` lists extra hostnames (www) that
   serve the customer app from the same distribution.
2. **First admin** on the prod pool (`JJ-prod-Auth`, see above).
3. **AI and proxy keys** in the prod secrets (see [Listing import](#configuration-per-environment)).
4. **Email at volume.** Verify a sender in SES, set `notify.mailFrom` and
   `notify.adminEmail`, redeploy.

Checking a prod deploy: `gh run list --workflow Deploy` shows the run;
`dig +short <hostname>` should return CloudFront addresses and
`curl -sI https://<hostname>/` a `200`. Your own machine may cache old DNS
for a few hours after a nameserver change; a phone on mobile data is the
quickest second opinion.

## CI/CD (GitHub Actions)

1. Push this repo to GitHub.
2. Create an IAM role for GitHub OIDC (trust `token.actions.githubusercontent.com`,
   condition on your repo) with permissions to deploy CDK (CloudFormation,
   plus the `cdk-*` bootstrap roles) and `s3 sync`/`cloudfront
   create-invalidation`; save its ARN as the repo secret **`AWS_DEPLOY_ROLE_ARN`**.
3. Create GitHub environments `dev` and `production`; add **required
   reviewers** on `production` — that is the manual approval gate before prod.

Every PR runs `ci.yml` (lint, typecheck, unit + integration tests against a
DynamoDB Local service container, frontend builds, cdk synth of dev). Pushes
to `main` run `deploy.yml`: verify → deploy dev (infra + migrations +
frontends + cache invalidation) → **manual approval** → deploy prod.

Day-to-day: work on a branch, open a PR, merge with
`gh pr merge <n> --merge --delete-branch`. Each merge starts a Deploy run
that waits at the production gate; when several are waiting, approve only
the newest (it contains the others; the prod jobs share a concurrency group
and would otherwise deploy one after another). If runs sit "queued" with no
runner for minutes, check https://www.githubstatus.com before suspecting the
repo.

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
| Route53 + certs (custom domain) | — | ~$1 | $0.50/zone; ACM free |
| Secrets Manager | <$1 | <$1 | $0.40 per secret per month, 2 per environment |
| **Total** | **~$2–3** | **~$16–19** | both environments ≈ **$20/mo** |

Per-use extras: the AI call is a few cents per imported listing; ScrapingBee
bills per fetched page on its own plan.

Cost levers: WAF off (`enableWaf: false`) saves ~$11; dev can be destroyed
when idle and redeployed in minutes.

## Security notes

- Admin and customer tokens are structurally separate (different Cognito
  issuers); admin routes also require the `admin` group.
- Customers only ever receive **published** listings with admin-private fields
  stripped, filtered to what their search may see; cross-tenant writes are
  blocked via event-carried listing state.
- Every admin mutation lands in a permanent audit log (who/what/before/after).
- Client interaction tracking is first-party only, tied to signed-in members,
  with a 180-day TTL — mention it in your privacy policy (GDPR).
- No secrets in the repo: infra wires identifiers through stack outputs/env;
  third-party keys live in Secrets Manager and are read at runtime.
- The customer app client hides whether an account exists (login and reset
  give the same answer for unknown addresses); see the note on forgot
  password above for the one side effect.
