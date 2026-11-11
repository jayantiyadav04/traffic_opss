# Traffic-Ops

Traffic violation management with React/Vite, Express and MongoDB. Citizens access their verified records, officers issue and resolve violations, and administrators provision privileged accounts and view global analytics.

## Implemented workflows

- Citizen-only public signup; admin-only privileged provisioning; 15-minute bearer sessions with server revocation on logout/password change.
- Staff-attested onboarding using an exact account email and stable citizen ID. Legacy name-derived associations remain quarantined until an explicit audited review.
- Server-priced violations with integer minor units, explicit currency and a snapshot of the fine policy.
- Officer operational access to violations; citizen-owned, officer-issued and admin-global dashboards with totals separated by currency.
- Search, status/date filters and signed cursor pagination, with explicit loading, error and empty states.
- Atomic manual settlements and server-backed receipts. Payment, violation and audit changes use MongoDB transactions.
- PayPal **Sandbox only** adapter, durable collection reservation, request idempotency, verified webhook inbox and reconciliation. Only synthetic USD checkout is enabled; existing INR values retain their currency.
- Responsive navigation, keyboard dialogs, reduced-motion support, frontend behavior tests, database integration tests and browser journeys.

Actual PayPal Sandbox create/capture/webhook verification and deployed hosting verification remain pending. Deterministic provider tests do not establish provider connectivity. This is a portfolio project, not a production enforcement or live-payment service.

## Local setup

Use Node **24.13 or newer within 24.x** and npm 11. The `.nvmrc` pins the verified Node version. MongoDB must support transactions: use a local replica set or an intentionally configured development replica-set deployment.

```sh
npm run install-all
```

This runs `npm ci` separately for root, client and server. Builds never install dependencies.

Copy `server/.env.example` to `server/.env`, then configure a development `MONGO_URI` and a locally generated `JWT_SECRET` of at least 32 characters. Set `CLIENT_ORIGINS` to exact frontend origins. Keep real secrets in the ignored environment file. The API awaits database readiness before listening; the Vite development server proxies `/api` to port 5000.

```sh
npm run dev
```

Frontend: `http://localhost:5173`. API: `http://localhost:5000`. Readiness: `/api/health/ready`; liveness: `/api/health/live`. Logs contain request IDs, method/path, status and timing, with no request bodies or bearer tokens.

## Synthetic demo data

The additive seed refuses production mode, remote targets and unconfirmed database names. It permits only a local disposable `traffic_ops_dev`, `traffic_ops_demo`, or generated `traffic_ops_test_<hex>` database. Configure `SEED_ALLOW_DISPOSABLE=true`, `SEED_CONFIRM_DATABASE` matching the database name and all three `SEED_ADMIN_PASSWORD`, `SEED_OFFICER_PASSWORD`, `SEED_CITIZEN_PASSWORD` values **locally**, then run:

```sh
node server/seed.js
```

The synthetic accounts are `admin@example.invalid`, `officer@example.invalid` and `citizen@example.invalid`. Passwords are supplied locally and never printed. Re-running the seed preserves existing passwords and unrelated records. It creates INR and USD fine policies and a synthetic area; an officer can then issue a violation to the verified synthetic citizen. Never run this seed against existing personal or production data.

## Verification

```sh
npm run verify
npx playwright install chromium
npm run test:e2e
```

`verify` runs frontend lint and behavior tests, backend HTTP/database/payment integration tests, a production build, OpenAPI validation and routing configuration checks. Browser tests include real isolated Express/MongoDB role/receipt journeys and separately identified API-fixture UI cases. They generate synthetic credentials at runtime and disable real provider configuration.

Database checks create and delete only a fresh temporary replica set. They refuse inherited `MONGO_URI`/`MONGODB_URI`. MongoDB Memory Server downloads its own binary; set `MONGOMS_SYSTEM_BINARY` and its matching `MONGOMS_VERSION` to use an installed `mongod` instead. It never attaches to an existing database. All tests use synthetic data; actual provider tests require a separate environment.

```sh
npm run test:load -- --records=1000 --concurrency=8 --duration=5
```

The load check creates another disposable replica set and reports its runtime, hardware, dataset, warmup, throughput, errors, p50/p95/p99 and query plans. Results describe local conditions, not production capacity.

## API and compatibility

The executable [OpenAPI specification](openapi.json) describes all 26 operations. Run `npm run check:api` to validate its schema and compare its method/path set with implemented routes.

| Area | Main endpoints |
| --- | --- |
| Sessions | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `PATCH /api/auth/password` |
| Accounts | Admin `POST /api/auth/users`; officer/admin `GET /api/auth/citizens?email=...` and `POST /api/auth/citizens/:id/verify` |
| Violations | `GET/POST /api/violations`, `GET /api/violations/:id`, type/area lookups, officer/admin ownership review |
| Dashboards | `GET /api/analytics/dashboard`; existing `/stats` and `/by-type` remain admin-only |
| Manual settlement | Officer/admin `PUT /api/violations/:id/pay` with method, reference, reason and `Idempotency-Key` |
| Sandbox | `GET /api/payments/config`, create/capture order, scoped payment/receipt lookup, explicit reconciliation, verified PayPal webhook |

The coordinated v2 API changes the violation list from an array to `{items,page:{limit,nextCursor,hasMore}}`. Limits default to20 and max100; ordering is `createdAt DESC,_id DESC`. Vehicle search is a normalized literal prefix. Date filters are UTC instants, inclusive `date_from` and exclusive `date_to`. A cursor is bound to caller scope and filters; new records ahead of a cursor appear on refresh.

Issue requests now use `citizen_id`; name-based auto-registration and client-supplied fine amounts are rejected. INR responses retain a legacy `fine_amount` alias during migration. Other currencies never receive that alias. `/analytics/stats` now uses grouped currency totals; its React consumer was updated together. No external client compatibility was assumed.

Manual settlement retains the route but requires audit fields and an idempotency key. The caller, operation and payload bind each key. One durable payment reservation per violation blocks competing manual/provider flows. Pending, failed and cancelled reservations remain held for review; there is no automatic fallback collection. A timeout is not proof of non-collection. After the provider's minimum retention window, an uncertain operation is reconciled with reads rather than started under a new identity.

## Migration and sandbox operations

`npm run migrate:money` defaults to a dry run and **does not load** `server/.env`. Supply a separate local rehearsal `MIGRATION_MONGO_URI` with a database name ending `_migration`, `_test` or `_dev`. Legacy values are explicitly INR; extra precision, invalid values and unsafe bounds require review. No rounding or currency conversion occurs.

For an apply rehearsal, set `MIGRATION_DATABASE_ACK` to that exact database name and run `npm run migrate:money -- --apply`. A local excluded EJSON backup is created before writes. Stop application writers during migration; restore both collections from that backup into a fresh rehearsal database to roll back. Apply is idempotent and leaves ownership unverified. Staff must first verify the account, then explicitly review each legacy violation with a citizen ID and evidence reference. Never infer ownership from names.

For real sandbox testing, configure `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`, `PAYPAL_WEBHOOK_ID` and `PUBLIC_BASE_URL` locally, with a supported synthetic USD business/buyer account pair. Register the reachable HTTPS webhook `/api/payments/webhooks/paypal`. The adapter hardcodes sandbox API endpoints and never enables live payments. An approval link alone does not settle a fine.

`npm run payments:reconcile` requires an explicitly supplied `MONGO_URI`, sandbox configuration and `RECONCILE_DATABASE_ACK=reviewed-target`; it does not load environment files. It reads pending known orders, atomically recovers verified collections and retries durably received webhooks. Unknown order creation after the retention window requires operator review. No scheduled job runs automatically.

## Hosting

`npm run build` produces `client/dist`. The Vercel configuration gives `/api` precedence, serves generated assets, then falls back to the SPA document for nested frontend routes. Local routing checks and browser refreshes are automated; real Vercel routing, reverse-proxy rate-limit identity and production deployment have not been verified. Publishing remains separate from implementation.

Vercel functions use the project's environment settings; the ignored local `server/.env` is not uploaded. In **Project Settings → Environment Variables**, configure `MONGO_URI` (with the intended database name), a locally generated `JWT_SECRET` of at least 32 characters, and `CLIENT_ORIGINS` equal to the exact frontend origin, without a trailing slash. Select **Production** for the production domain. Environment changes apply to a new deployment, so redeploy after updating them. See [Vercel environment configuration](https://vercel.com/docs/environment-variables).

Serverless `/api/health/live` remains available independently of database/configuration readiness. `/api/health/ready` returns 503 until startup succeeds. Startup failures distinguish configuration, database connection and constraint/topology initialization with safe error codes; function logs contain only the stage, request ID, allowlisted configuration field name and numeric database error code. Secret values, raw exception messages and connection strings are never logged.
