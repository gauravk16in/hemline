import { trace, span, setTraceOutput } from "neatlogs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  mutate,
  createSandbox,
  resetLocalTestWard,
  readWard,
  health,
  budgetDiagnostics,
} from "@/lib/store";
import {
  session,
  signSession,
  originCheck,
  workerCheck,
  hash,
  provisionIdentity,
  isLocalDemo,
} from "@/lib/security";
import {
  roles,
  commandSchema,
  command,
  confirmProposal,
  confirmReplacement,
  reconcileAcceptance,
  addMessage,
  advance,
  destinationDelay,
  destinationFor,
  queueRun,
  event,
  DomainError,
  findTransfer,
} from "@/lib/domain";
import {
  client,
  fixtureMode,
  shutdownTelemetry,
  drainTelemetry,
} from "@/lib/agent";
import { tick } from "@/lib/worker";
export const runtime = "nodejs";
// Vercel allows the bounded 90-second agent activation plus database/export overhead.
export const maxDuration = 180;
export const dynamic = "force-dynamic";
const params = z.object({}).passthrough();
async function handle(req: NextRequest) {
  try {
    const path = req.nextUrl.pathname.replace("/api/", "").split("/");
    if (path[0] === "internal") {
      workerCheck(req);
      if (req.method !== "POST")
        throw new DomainError("METHOD", "POST required", 405);
      if (path[1] === "budget")
        return NextResponse.json(await budgetDiagnostics());
      return NextResponse.json(
        path[1] === "shutdown"
          ? (await shutdownTelemetry(), { ok: true })
          : await tick(),
      );
    }
    if (path[0] === "health") {
      const h = await health();
      return NextResponse.json(
        {
          ...h,
          environment: process.env.NODE_ENV,
          model: fixtureMode()
            ? "local fixture adapter"
            : process.env.OPENAI_API_KEY
              ? "live provider configured"
              : "unconfigured",
          tracing: !!process.env.NEATLOGS_API_KEY,
          publicProvisioning: process.env.PUBLIC_DEMO_ENABLED === "true",
        },
        {
          status:
            process.env.NODE_ENV === "production" && !h.worker ? 503 : 200,
        },
      );
    }
    if (req.method === "GET") {
      const s = session(req),
        w = await readWard(s.id, s.owner);
      if (path[0] === "ward")
        return NextResponse.json({
          ...w,
          adapter: fixtureMode() ? "fixture" : "live",
          tracingConfigured: !!process.env.NEATLOGS_API_KEY,
        });
      if (path[0] === "runs")
        return NextResponse.json(w.runs.find((r) => r.id === path[1]) || null);
      if (path[0] === "transfers")
        return NextResponse.json({
          transfer: findTransfer(w, path[1]),
          events: w.events.filter((e) => e.transferId === path[1]),
        });
      throw new DomainError("NOT_FOUND", "Endpoint not found", 404);
    }
    originCheck(req);
    const length = Number(req.headers.get("content-length") || 0);
    if (length > 16000) throw new DomainError("SIZE", "Request too large", 413);
    const text = await req.text();
    if (text.length > 16000)
      throw new DomainError("SIZE", "Request too large", 413);
    const testForm =
      path[0] === "sandbox" &&
      path[1] === "test" &&
      req.headers
        .get("content-type")
        ?.includes("application/x-www-form-urlencoded");
    const body = params.parse(
      testForm
        ? Object.fromEntries(new URLSearchParams(text))
        : JSON.parse(text || "{}"),
    );
    const idem =
      req.headers.get("idempotency-key") ||
      (testForm ? crypto.randomUUID() : null);
    if (!idem || idem.length > 100)
      throw new DomainError("IDEMPOTENCY", "Idempotency-Key required", 400);
    if (path[0] === "sandbox" && path[1] === "test") {
      if (
        !isLocalDemo() ||
        process.env.DATABASE_URL ||
        process.env.POSTGRES_URL
      )
        throw new DomainError("TEST_ONLY", "Local development/test only", 403);
      const name = z
        .string()
        .regex(/^[a-z0-9-]{1,80}$/)
        .parse(body.sessionId);
      const owner = `test-${hash(name)}`;
      const w = await resetLocalTestWard(owner, name);
      const response = testForm
        ? NextResponse.redirect(
            new URL("/", `${req.nextUrl.protocol}//${req.headers.get("host")}`),
            303,
          )
        : NextResponse.json(w);
      response.cookies.set("hemline_session", signSession(owner, w.id), {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        maxAge: 7200,
      });
      return response;
    }
    if (path[0] === "sandbox" && path.length === 1) {
      let existing;
      try {
        existing = session(req);
      } catch {}
      if (existing) {
        try {
          return NextResponse.json(await readWard(existing.id, existing.owner));
        } catch {}
      }
      const owner = await provisionIdentity(
        typeof body.captchaToken === "string" ? body.captchaToken : null,
        idem,
      );
      const w = await createSandbox(owner);
      const response = NextResponse.json(w);
      response.cookies.set("hemline_session", signSession(owner, w.id), {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 7200,
      });
      return response;
    }
    const s = session(req);
    const payloadHash = createHash("sha256")
      .update(req.nextUrl.pathname + text)
      .digest("hex");
    const value = await mutate(s.id, s.owner, (w) => {
      const previous = w.receipts[idem];
      if (previous) {
        if (previous.hash !== payloadHash)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            "Key reused with different payload",
          );
        return previous.result;
      }
      if (Object.keys(w.receipts).length >= 500)
        throw new DomainError("QUOTA", "Sandbox action limit reached", 429);
      let result: unknown = { ok: true };
      if (path[0] === "sandbox" && path[1] === "role") {
        const role = z.enum(roles).parse(body.role);
        w.role = role;
        if (body.takeover === true) {
          w.takenOver = [...new Set([...w.takenOver, role])];
          w.scheduled = w.scheduled.filter((a) => a.role !== role);
          event(w, `${role} role taken over by visitor`, role);
        }
      } else if (path[0] === "sandbox" && path[1] === "playback") {
        const b = z
          .object({
            mode: z.enum(["guided", "manual"]).optional(),
            paused: z.boolean().optional(),
            advance: z
              .union([z.literal(15), z.literal(30), z.literal(60)])
              .optional(),
          })
          .strict()
          .parse(body);
        if (b.mode) {
          w.mode = b.mode;
          w.paused = b.mode === "manual";
          w.takenOver = [];
          if (b.mode === "manual") w.scheduled = [];
        }
        if (b.paused !== undefined) w.paused = b.paused;
        if (b.advance) {
          if (!w.paused)
            throw new DomainError("CLOCK", "Pause before advancing manually");
          advance(w, b.advance);
        }
        w.lastTick = Date.now();
      } else if (path[0] === "messages" || path[0] === "staff-messages") {
        const b = z
          .object({
            text: z.string().min(1).max(2000),
            transferId: z.string().nullable().optional(),
          })
          .strict()
          .parse(body);
        result = addMessage(w, b.text, w.role, b.transferId || null);
      } else if (path[0] === "replacements" && path[2] === "confirm") {
        result = confirmReplacement(w, path[1], w.role);
      } else if (path[0] === "proposals" && path[2] === "confirm") {
        result = confirmProposal(w, path[1], w.role);
      } else if (path[0] === "transfers" && path[2] === "commands") {
        const c = commandSchema.parse(body);
        result =
          c.type === "ACCEPT"
            ? reconcileAcceptance(
                w,
                path[1],
                z.string().parse(c.payload.offerId),
                c.expectedRevision,
                w.role,
              )
            : { id: command(w, path[1], c, w.role).id };
        const t = findTransfer(w, path[1]);
        // Deterministic staff progress does not need an LLM activation. Dispatch only at a ready boundary.
        if (
          t.phase === "READY" &&
          t.control === "ACTIVE" &&
          (!t.offer || !["pending", "accepted"].includes(t.offer.status))
        )
          queueRun(
            w,
            "Readiness confirmed; choose eligible porter and offer transport.",
            w.role,
            t.id,
          );
      } else if (path[0] === "destinations" && path[2] === "commands") {
        const b = z
          .object({
            type: z.enum([
              "SET_DESTINATION_AVAILABILITY",
              "SET_RECEIVING_WINDOW",
            ]),
            expectedRevision: z.number(),
            payload: z.object({
              delayMinutes: z.number().min(0).max(240).optional(),
              windowEnd: z.number().optional(),
            }),
          })
          .strict()
          .parse(body);
        if (w.role !== "receiving")
          throw new DomainError("FORBIDDEN", "Receiving staff required", 403);
        if (!["radiology", "ct"].includes(path[1]))
          throw new DomainError("NOT_FOUND", "Destination missing", 404);
        const name = path[1] === "ct" ? "CT" : "Radiology";
        const destination = destinationFor(w, name);
        if (b.expectedRevision !== destination.revision)
          throw new DomainError("STALE_REVISION", "Destination changed");
        if (b.type === "SET_DESTINATION_AVAILABILITY")
          destinationDelay(
            w,
            b.payload.delayMinutes || 0,
            w.role,
            "visitor",
            name,
          );
        else {
          if (!b.payload.windowEnd || b.payload.windowEnd < w.now)
            throw new DomainError("WINDOW", "Window must be in the future");
          destination.windowEnd = b.payload.windowEnd;
          destinationDelay(
            w,
            Math.max(0, (destination.availableAfter - w.now) / 60000),
            w.role,
            "visitor",
            name,
          );
        }
      } else if (path[0] === "scenarios") {
        const b = z
          .object({
            scenario: z.enum([
              "standard",
              "rejection",
              "missing_readiness",
              "destination_delay",
              "timeout",
              "ambiguous_patient",
              "stale_availability",
            ]),
          })
          .strict()
          .parse(body);
        w.scenario = b.scenario;
        if (b.scenario === "ambiguous_patient")
          addMessage(
            w,
            "Arrange Patel's transfer from Bed 4 to radiology.",
            "nurse",
            null,
            "simulated staff",
          );
        if (b.scenario === "destination_delay") {
          const t = w.transfers.find((t) => t.phase !== "COMPLETED");
          if (t)
            addMessage(
              w,
              "Scanner delayed 15 minutes. We can receive the patient afterward.",
              "receiving",
              t.id,
              "simulated staff",
            );
          else
            throw new DomainError(
              "TARGET",
              "Create a transfer before activating delay",
            );
        }
        if (b.scenario === "stale_availability") w.staff[0].available = false;
        if (b.scenario === "missing_readiness") {
          const t = w.transfers.at(-1);
          if (t)
            addMessage(
              w,
              "Oxygen equipment is missing.",
              "nurse",
              t.id,
              "simulated staff",
            );
        }
        if (b.scenario === "timeout") {
          w.takenOver.push("porter");
          w.scheduled = w.scheduled.filter((a) => a.role !== "porter");
        }
        event(
          w,
          `Scenario selected: ${b.scenario}`,
          "coordinator",
          null,
          "simulation control",
        );
      } else throw new DomainError("NOT_FOUND", "Endpoint not found", 404);
      w.receipts[idem] = { hash: payloadHash, result: structuredClone(result) };
      return result;
    });
    return NextResponse.json(value);
  } catch (error) {
    // Keep internal failure details out of the HTTP response, but emit
    // non-sensitive diagnostics for production investigation.
    if (
      !(error instanceof DomainError) &&
      !(error instanceof z.ZodError) &&
      !(error instanceof SyntaxError)
    ) {
      const details =
        error !== null && typeof error === "object"
          ? (error as { code?: unknown; cause?: unknown })
          : null;
      const cause =
        details?.cause !== null && typeof details?.cause === "object"
          ? (details.cause as { code?: unknown })
          : null;
      console.error("Hemline unexpected API failure", {
        route: req.nextUrl.pathname,
        method: req.method,
        name: error instanceof Error ? error.name : typeof error,
        code: typeof details?.code === "string" ? details.code : null,
        causeCode: typeof cause?.code === "string" ? cause.code : null,
      });
    }
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 503;
    return NextResponse.json(
      {
        error:
          error instanceof DomainError
            ? error.code
            : status === 400
              ? "VALIDATION"
              : "UNAVAILABLE",
        message:
          error instanceof DomainError
            ? error.message
            : status === 400
              ? "Invalid request"
              : "Service unavailable. Check server configuration.",
      },
      { status },
    );
  }
}
async function route(req: NextRequest) {
  try {
    if (
      !process.env.NEATLOGS_API_KEY ||
      req.method !== "POST" ||
      req.nextUrl.pathname.includes("/internal/")
    )
      return await handle(req);
    await client();
    let correlation = "hemline-unowned-command-attempts";
    try {
      const identity = session(req);
      const state = await readWard(identity.id, identity.owner);
      correlation = state.testSessionId || state.id;
    } catch {}
    let response: NextResponse | undefined;
    await trace(
      {
        name: "hemline-http-command",
        kind: "WORKFLOW",
        sessionId: correlation,
      },
      async (active) => {
        const outcome = await span(
          {
            name: "http_command_attempt",
            kind: "TOOL",
            toolName: "http_command_attempt",
            captureOutput: true,
          },
          async () => {
            response = await handle(req);
            response.headers.set(
              "x-hemline-trace-id",
              active.spanContext().traceId,
            );
            return {
              route: req.nextUrl.pathname,
              status: response.status,
              accepted: response.ok,
            };
          },
        )();
        setTraceOutput(outcome);
      },
    );
    return response!;
  } finally {
    // Serverless instances can freeze after the response; export ended spans first.
    if (process.env.VERCEL && req.method === "POST")
      await drainTelemetry().catch(() =>
        console.error("Hemline telemetry flush failed"),
      );
  }
}
export const GET = route;
export const POST = route;
