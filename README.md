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

## Implementation status

Implemented: web board, role actions, browser dictation with review, durable PostgreSQL aggregate transactions, offers, destination delays, interpretation proposals, guided staff, controllable clock, isolation, quotas, OpenAI-compatible Claude/neatlogs adapters, worker supervision and Render blueprint.

Verified externally: Claude gateway text response, Neatlogs diagnostic export/readback, and live agent activations with finalized workflow/tool traces; 47/48 activation cases passed, and the failed delay case passed 3/3 targeted reruns after a source-ID fix.

Not yet externally verified: hosted Supabase/Render, final 48-case rerun after the prompt fix, cfo.ai business output, and live browser microphone behavior. The full 48-case suite scored 47/48; a source-ID correction subsequently passed three targeted reruns. A complete rerun after that correction remains a release gate.

This is a synthetic hackathon prototype, not a hospital deployment. Do not enter real patient information. Local fixture checks do not establish live agent quality.

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
