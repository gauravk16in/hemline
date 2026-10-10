import nextEnv from "@next/env";
import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Ward, Transfer, Command, Role } from "../lib/domain";
nextEnv.loadEnvConfig(process.cwd());
// Dedicated in-memory PostgreSQL, real provider and telemetry; never touch visitor state.
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
const { createSandbox, mutate, readWard, claim, finish } =
  await import("../lib/store");
const d = await import("../lib/domain");
const { activate, client, shutdownTelemetry } = await import("../lib/agent");
const { trace, span } = await import("neatlogs");
if (!process.env.OPENAI_API_KEY || !process.env.NEATLOGS_API_KEY)
  throw Error("Real provider and neatlogs credentials required");
await mkdir("evidence", { recursive: true });
const owner = "interruption-validation";
const initial = await createSandbox(owner);
const sid = initial.id;
let outerTraceId = "";
const activations: unknown[] = [];
async function action<T>(name: string, fn: (w: Ward) => T) {
  return span({ kind: "TOOL", toolName: name }, () => mutate(sid, owner, fn))();
}
async function runPending() {
  for (let count = 0; count < 8; count++) {
    const job = await claim(sid);
    if (!job) return;
    try {
      await activate(sid, job.token, job.run_id);
      await finish(job.token);
      const w = await readWard(sid, owner);
      activations.push(w.runs.find((r) => r.id === job.run_id));
    } catch (e) {
      await finish(job.token, "error");
      throw e;
    }
  }
  throw Error("Activation queue did not drain");
}
function command(
  w: Ward,
  t: Transfer,
  type: Command["type"],
  role: Role,
  payload: Record<string, unknown> = {},
) {
  return d.command(
    w,
    t.id,
    { type, expectedRevision: t.revision, payload },
    role,
    "validation staff",
  );
}
try {
  await client();
  await trace(
    {
      name: "hemline-interrupted-transfer-late-acceptance",
      kind: "WORKFLOW",
      sessionId: sid,
    },
    async (active) => {
      outerTraceId = active.spanContext().traceId;
      await action("transport.request_received", (w) =>
        d.addMessage(
          w,
          "Hemline, arrange transport for Bed 18 to Radiology.",
          "nurse",
          null,
        ),
      );
      await runPending();
      let w = await readWard(sid, owner);
      assert.equal(w.transfers.length, 1);
      const oldId = w.transfers[0].id;
      assert.equal(w.transfers[0].patientId, "enc-04");
      assert.equal(w.transfers[0].destinationName, "Radiology");
      assert.equal(w.transfers[0].phase, "DRAFT");
      await action("readiness.confirmed", (w) => {
        const t = d.findTransfer(w, oldId);
        command(w, t, "CONFIRM_REQUEST", "nurse");
        for (const requirement of ["nurse", "escort", "receiving"])
          command(
            w,
            t,
            "CONFIRM_READINESS",
            requirement === "receiving" ? "receiving" : "nurse",
            { requirement },
          );
        d.queueRun(
          w,
          "Ready: offer transport to an eligible porter.",
          "nurse",
          t.id,
        );
      });
      await runPending();
      w = await readWard(sid, owner);
      const slow = d.findTransfer(w, oldId).offer!;
      assert.equal(slow.porterId, "porter-1");
      assert.equal(slow.status, "pending");
      assert.equal(d.findTransfer(w, oldId).phase, "OFFERING");
      await action("porter_offer.timed_out", (w) => d.advance(w, 46));
      await action("request.interrupted", (w) =>
        d.addMessage(
          w,
          "Wait—cancel Bed 18. Bed 21 needs transport to CT instead.",
          "nurse",
          oldId,
        ),
      );
      await runPending();
      w = await readWard(sid, owner);
      const proposal = w.replacements?.find((p) => p.oldTransferId === oldId);
      assert.ok(
        proposal,
        "Live model must propose nurse-confirmed replacement",
      );
      assert.equal(proposal.patientId, "enc-05");
      assert.equal(proposal.destinationName, "CT");
      assert.equal(w.transfers.length, 1);
      await action("old_task.cancelled_new_task.created", (w) =>
        d.confirmReplacement(w, proposal.id, "nurse"),
      );
      w = await readWard(sid, owner);
      const replacement = w.replacements!.find((p) => p.id === proposal.id)!;
      const newId = replacement.newTransferId!;
      assert.equal(d.findTransfer(w, oldId).control, "CANCELLED");
      assert.deepEqual(d.findTransfer(w, newId).confirmations, {});
      const late = await action("late_acceptance.rejected", (w) =>
        d.reconcileAcceptance(
          w,
          oldId,
          slow.id,
          slow.revision,
          "porter",
          "delayed simulated staff",
        ),
      );
      assert.equal(late.rejected, true);
      await action("replacement.readiness_confirmed", (w) => {
        const t = d.findTransfer(w, newId);
        command(w, t, "CONFIRM_REQUEST", "nurse");
        for (const requirement of ["nurse", "escort", "receiving"])
          command(
            w,
            t,
            "CONFIRM_READINESS",
            requirement === "receiving" ? "receiving" : "nurse",
            { requirement },
          );
        w.staff.find((s) => s.id === "porter-1")!.available = false;
        d.queueRun(
          w,
          "Ready for CT: offer transport to an eligible porter.",
          "nurse",
          newId,
        );
      });
      await runPending();
      w = await readWard(sid, owner);
      const accepted = d.findTransfer(w, newId).offer!;
      assert.equal(accepted.porterId, "porter-2");
      await action("porter_offer.accepted", (w) =>
        d.reconcileAcceptance(
          w,
          newId,
          accepted.id,
          accepted.revision,
          "porter",
          "simulated Leena",
        ),
      );
      await action("collection.confirmed", (w) =>
        command(w, d.findTransfer(w, newId), "COLLECT", "porter"),
      );
      await action("arrival.confirmed", (w) =>
        command(w, d.findTransfer(w, newId), "ARRIVE", "porter"),
      );
      w = await readWard(sid, owner);
      assert.equal(d.findTransfer(w, newId).phase, "ARRIVED");
      await action("handoff.acknowledged", (w) =>
        command(w, d.findTransfer(w, newId), "HANDOFF", "receiving"),
      );
      w = await readWard(sid, owner);
      assert.equal(d.findTransfer(w, newId).phase, "COMPLETED");
      assert.equal(d.findTransfer(w, newId).destinationName, "CT");
      assert.equal(d.findTransfer(w, oldId).control, "CANCELLED");
      assert.notEqual(d.findTransfer(w, oldId).offer?.status, "accepted");
      assert.ok(w.porterNotifications?.length);
      await writeFile(
        "evidence/interrupted-transfer-live-after.json",
        JSON.stringify(
          {
            passed: true,
            outerTraceId,
            activations,
            estimatedCost: w.cost,
            final: w,
          },
          null,
          2,
        ),
      );
      console.log(
        JSON.stringify({
          passed: true,
          outerTraceId,
          activations: activations.length,
          estimatedCost: w.cost,
        }),
      );
    },
  );
} catch (error) {
  const w = await readWard(sid, owner);
  await writeFile(
    "evidence/interrupted-transfer-live-failure.json",
    JSON.stringify(
      {
        outerTraceId,
        error: error instanceof Error ? error.message : "Unknown failure",
        activations,
        final: w,
      },
      null,
      2,
    ),
  );
  console.error(error instanceof Error ? error.message : "Validation failed");
  process.exitCode = 1;
} finally {
  await shutdownTelemetry();
}
