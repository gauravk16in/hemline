# Hemline

**Hospital coordination, from request to verified handoff.**

Hemline interprets transfer goals and messy staff replies, tracks readiness, recovers from porter rejection and destination delays, and requires receiving-team acknowledgement before completion.

## Run locally

```bash
npm ci
cp .env.example .env.local
npm run dev
# in another terminal
npm run worker:dev
```

Open http://127.0.0.1:3000. No credentials are required for the **explicit local fixture adapter** and embedded PostgreSQL. That adapter is deterministic, not an LLM. Configure the Aivar gateway with claude-sonnet-4.6 to use the real chat tool loop and neatlogs to export real traces.

Try Bed 18 first. Bed 4 intentionally has a stale reference in another patient's bed history. Manual exploration begins paused. Choose guided playback before confirming a request to activate labelled simulated staff replies. A visitor still confirms the original nurse request and material rescheduling.

## Ward interface

The ward fills the viewport. Patient bays are interactive overlays on the ward scene asset from the user's previous [project](https://github.com/Abhinav-Prabhakar/Warden), reused at the user's request. Hemline keeps its own encounters, state machine, agent tools, database and telemetry. Selecting a bed opens a contextual staff-action panel; history opens from the left rail. The clock menu contains playback, scenario and usage controls. No clinical measurements or medication workflows are imported. Route positions illustrate recorded workflow stages, not tracked staff locations.

The voice dock supports browser dictation with transcript review and optional spoken recorded summaries. Mobile supports horizontal ward exploration and contextual panels; unsupported browsers retain text input. Routes are static; no looping movement implies tracked staff. The attention queue, sync age, readiness evidence and receiving acknowledgement show recorded operational facts. Pickup deadlines are labelled as simulation time and ETA is explicitly unavailable. Live microphone permission and recognition accuracy remain unverified.

## Implementation status

Implemented: web board, role actions, browser dictation with review, durable PostgreSQL aggregate transactions, offers, destination delays, interpretation proposals, guided staff, controllable clock, isolation, quotas, OpenAI-compatible Claude/neatlogs adapters, worker supervision and Render blueprint.

Verified externally: Claude gateway text response, Neatlogs diagnostic export/readback, and live agent activations with finalized workflow/tool traces; 47/48 activation cases passed, and the failed delay case passed 3/3 targeted reruns after a source-ID fix.

Not yet externally verified: hosted Supabase/Render, final 48-case rerun after the prompt fix, cfo.ai business output, and live browser microphone behavior. The full 48-case suite scored 47/48; a source-ID correction subsequently passed three targeted reruns. A complete rerun after that correction remains a release gate.

This is a synthetic hackathon prototype, not a hospital deployment. Do not enter real patient information. Local fixture checks do not establish live agent quality.

### Current audit corrections — 2026-10-11

Cancelled transfers now reject resume/takeover. Collected or arrived transfers require an acknowledged staff-resolution note before coordinator resume; physical state and porter are retained. Unresolved requests produce clarification. The status/voice dock follows current persisted state, and HTTP outcomes (including rejections) return a trace ID. Missing readiness appears in the attention count. Output allowance is 600 tokens within the 1,000-token ceiling; reservations use measured input plus a safety margin.

Verified: 58 deterministic/integration tests; all six browser tests passed during the fix sequence, followed by four focused final-code browser checks; typecheck/lint/build; local process restart preserving transfers/events/receipts/paused time. Guided real-model rejection recovery completed under the $0.25 cap at estimated $0.2314224. The latest full evaluation scored 46/48 (95.8%): two provider connection/timeout failures, followed by six passing targeted reruns after connection-retry handling. Final dispatch/output optimizations passed the guided-cap journey; a full 48-case rerun after those last optimizations remains pending within a new testing budget. Actual microphone/audio and hosted-worker restart are unverified. Render worker setup requires account sign-in; a Vercel page alone is not an operational worker.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
npx playwright install chromium
npm run test:e2e
npm run build
# needs configured real provider
npm run provider:smoke
npm run eval
```

Browser tests require a running development worker. Configure a dedicated test database for hosted integration tests, never the public demo database.

## Development notes

Supplemental specifications, development history and generated trace/test evidence are retained locally and excluded from this published source repository. Only the root README is published as Markdown.

## Hosting

One Render service supervises `next start` and the worker. Supabase supplies hosted PostgreSQL and anonymous authentication. Review `render.yaml` and operations before provisioning. Public creation stays disabled until authentication/CAPTCHA and database access are configured.

MIT license. All seeded patients, staff, and hospital responses are fictional.

Private local demos default to a $1 per-sandbox model allowance (`LOCAL_SANDBOX_MODEL_BUDGET_USD`); public sandboxes retain the $0.25 cap. Both remain subject to the $10 overall model budget. Budget reservations and usage persist across restarts. A transfer paused by a budget refusal can be resumed by switching to Coordinator and selecting Resume coordination after the limit is corrected.

## Interrupted transfer validation

Bed 21 → CT is supported alongside Bed 18 → Radiology. A nurse interruption pauses dispatch and produces a replacement proposal. Nurse confirmation cancels the old transfer and creates a new draft with independent readiness. An accepted assignment requires porter cancellation acknowledgement first; collected patients require staff intervention. Late acceptance is rejected, audited and shown in the simulated porter inbox. Deterministic collection/arrival/handoff actions do not consume additional model activations.

Run `npx tsx scripts/test-interrupted-transfer.ts` with provider and neatlogs credentials to reproduce the isolated in-memory PostgreSQL test. It uses real model calls and trace export; staff confirmations are explicitly scripted. On 2026-10-10 the complete scenario passed with Claude Sonnet 4.6, five activations, estimated cost $0.2202123, trace `b1826c145f143a7d0f4667bdf52a5332`. Authenticated neatlogs readback succeeded. Local evidence is ignored by Git. The preserved baseline showed the old guard already rejected stale acceptance; missing replacement support and rejection audit were the improvements. This targeted run does not establish the 48-case release gate or deployed restart verification.

Prompt v5 compacts model context and records tool arguments. The latest isolated interruption rerun passed at estimated $0.1779987 with trace `065487d6cb5a4d635721a4e487fc6bf7`. 53 deterministic/integration checks passed after the fixes. Broader guided browser findings and preserved failures are recorded in docs/testing.md; a targeted pass does not imply the release suite is complete.

Final local validation (2026-10-11): prompt v6 interrupted-transfer scenario passed with authenticated neatlogs export; 55 domain/integration tests and the full six-test browser suite passed, alongside typecheck, lint and build. Guided rejection recovery and receiving delay both passed with the live provider. Evidence: `evidence/interruption-validation.md` (local, ignored by Git). Public provisioning and the 48-case release evaluation remain pending; latest private guided usage exceeds the public $0.25 cap.

### Verified stale-acceptance HTTP scenario

`npx tsx scripts/test-stale-http.ts` first verifies localhost is development with local embedded PostgreSQL and real provider/tracing configured, then resets only the named synthetic test ward. It preserves other wards and global spending. The reset endpoint is disabled for production, public provisioning, and hosted databases. The script exercises authenticated HTTP requests, waits for the real worker/LLM, and saves assertions to `evidence/stale-http-result.json`.

Watch `/test/live` in the local browser while it runs. This read-only development view shows test aliases T-001/T-002, actual UUIDs, statuses and events. The confirmed run persisted all 26 domain events plus real model/tool calls in neatlogs session `hemline-stale-acceptance-test-001` (22 distinct traces, 78 spans, zero trace errors). Samir's delayed acceptance was rejected after cancellation; Leena's replacement completed only after receiving-team handoff. `COMPLETED` is the domain's handoff-complete status. The labelled stale-availability fixture keeps Samir unavailable for the replacement. Staff and patient data remain synthetic; API, persistence, model and telemetry calls are real.

### Deploy through Vercel GitHub import

Import this GitHub repository as a Next.js project, root directory `.`. `vercel.json` selects `npm ci` and `npm run build:web`; Node 22 is selected by `package.json`. The authenticated internal worker endpoint has a 180-second function limit. Its PostgreSQL migration is explicitly included in the serverless function bundle. Completed telemetry is flushed before mutation responses on Vercel.

Vercel runs the web/API application. A separate always-running worker calls the authenticated tick endpoint; Vercel does not run `npm start` or the continuous supervisor. Import `render-worker.yaml` as a Render worker blueprint, with `APP_BASE_URL` pointing to the stable Vercel production URL and the same `WORKER_SECRET` configured in both services. Set `REMOTE_WORKER=true` on the worker. If deployment protection is enabled, its automation bypass secret goes only on the worker. The worker does not need database, LLM or neatlogs keys. The original single-service Render deployment remains available in `render.yaml`.

Vercel server environment: `DATABASE_URL` (dedicated hosted PostgreSQL / Supabase session pooler), `SESSION_SECRET`, `WORKER_SECRET`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `MODEL_API`, `NEATLOGS_API_KEY`, model pricing ceilings and existing spending limits. For public provisioning, also set Supabase URL/anon key, Turnstile site key/secret, `APP_BASE_URL` and `PUBLIC_DEMO_ENABLED=true`; enable anonymous auth and register the production hostname with Turnstile. `NEXT_PUBLIC_*` values must be configured before the build. Keep public provisioning disabled until these are verified. Local embedded PostgreSQL and development test/reset routes are unavailable in production.

Start with an isolated hosted test database and provisioning disabled; then verify DB health, worker heartbeat, real provider/tracing and owned synthetic test flows before enabling public access. A deployed page alone does not establish agent readiness. Hosted Vercel, worker restart, public onboarding and browser-closure recovery are pending external verification until accounts/services are configured.

Vercel Supabase integration: `POSTGRES_URL` is accepted when `DATABASE_URL` is unset. No database credentials need to be copied into Git or client code. Explicit `DATABASE_URL` takes precedence. Hosted integration variables also disable local test-reset endpoints.

If hosted PostgreSQL reports `SELF_SIGNED_CERT_IN_CHAIN`, set `DATABASE_CA_CERT` to the PEM certificate downloaded from Supabase Database Settings. Hemline verifies both the certificate chain and database hostname; do not disable TLS verification.

Public onboarding requires Turnstile and anonymous authentication. There is no hourly per-IP creation quota. Existing signed-in sessions reopen their workspace; ownership isolation, command rate limits and model spending caps remain enforced. The interface uses plain patient-transport language and keeps a brief fictional-records notice.

Audit corrections: cancelled transfers are terminal; post-collection resume records an acknowledged staff resolution while retaining the porter. Operational voice/status summaries follow committed state. Unresolved requests receive clarification. Tracing records HTTP outcomes and committed events across workspaces; response trace IDs support readback. Verification results are recorded locally until final checks finish.

## Restricted AWS worker (deployed; extended recovery verification pending)

`aws/lambda_function.py` supplies a Python 3.12 Lambda dispatcher/worker in us-east-1. It calls the existing authenticated Vercel tick API; model calls, persistence and neatlogs remain on Vercel. A function-specific IAM role can invoke only `hemline-worker`; no EC2 instance, load balancer, EventBridge, CloudWatch policy or additional VPC is needed. The existing team EC2 instance is untouched.

Configure 256 MB memory, a 900-second timeout, reserved concurrency 2, asynchronous retries 2 and maximum event age 900 seconds. Lambda stores only APP_BASE_URL and WORKER_SECRET in a private deployment configuration file excluded from Git; the hackathon account denies KMS-backed environment updates. Its Function URL uses application bearer authentication; invalid requests never dispatch jobs. Set LAMBDA_WORKER_URL on Vercel only after the endpoint is protected by the deployed handler. Authenticated browser/API activity wakes it; PostgreSQL admission and owner leases prevent competing tick loops. Invocations hand off asynchronously in at most 12 slices, bounded by a two-hour session. Idle sessions stop immediately. Simulation timers use existing paused-clock semantics; Lambda does not poll the model while waiting.

This is activity-driven bounded scheduling, not an unlimited always-on service. Hard session expiry or exhausted asynchronous retries require subsequent authenticated activity to recover; state and job leases persist. Hosted authorization has been verified (403 without a bearer secret, 202 with it), and the Vercel API received a real worker heartbeat. Extended hosted handoff/restart behavior remains to be verified. Health reports a recent worker heartbeat; idle sessions can report worker unavailable after the freshness window until authenticated activity wakes them. Disable via reserved concurrency 0 and clear LAMBDA_WORKER_URL when finished; Lambda does not incur compute while idle. The $25 account allowance is shared and cannot be guaranteed by code alone.

Local scheduler checks: `npm test -- tests/scheduler.test.ts`; `python3 aws/test_lambda.py`.
