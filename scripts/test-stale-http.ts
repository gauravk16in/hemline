import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Ward, Command, Role } from "../lib/domain";
const base = "http://127.0.0.1:3000";
let cookie = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(path: string, body?: unknown) {
  const r = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const v = await r.json();
  if (!r.ok) throw Error(`${path}: ${JSON.stringify(v)}`);
  return v;
}
const ward = async () => (await api("ward")) as Ward;
async function role(role: Role) {
  await api("sandbox/role", { role });
}
async function cmd(
  id: string,
  type: Command["type"],
  payload: Record<string, unknown> = {},
) {
  const t = (await ward()).transfers.find((t) => t.id === id)!;
  return api(`transfers/${id}/commands`, {
    type,
    expectedRevision: t.revision,
    payload,
  });
}
async function drain() {
  for (let i = 0; i < 100; i++) {
    const w = await ward();
    if (w.runs.every((r) => r.status === "done" || r.status === "error")) {
      const failed = w.runs.filter((r) => r.status === "error");
      assert.equal(failed.length, 0, JSON.stringify(failed));
      return;
    }
    await sleep(1000);
  }
  throw Error("Agent queue timed out");
}
async function readiness(id: string) {
  await role("nurse");
  await cmd(id, "CONFIRM_REQUEST");
  await cmd(id, "CONFIRM_READINESS", { requirement: "nurse" });
  await cmd(id, "CONFIRM_READINESS", { requirement: "escort" });
  await role("receiving");
  await cmd(id, "CONFIRM_READINESS", { requirement: "receiving" });
  await drain();
}
const health = await api("health");
assert.equal(health.environment, "development");
assert.equal(health.storage, "local embedded PostgreSQL");
assert.equal(health.tracing, true);
assert.equal(health.model, "live provider configured");
const provision = await fetch(`${base}/api/sandbox/test`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": crypto.randomUUID(),
  },
  body: JSON.stringify({ sessionId: "hemline-stale-acceptance-test-001" }),
});
assert.equal(provision.status, 200);
cookie = provision.headers.get("set-cookie")!.split(";")[0];
assert.equal((await ward()).transfers.length, 0);
let stage = "request";
try {
  await role("nurse");
  await api("messages", {
    text: "Hemline, arrange transport for Bed 18 to Radiology.",
  });
  await drain();
  let w = await ward();
  assert.equal(w.transfers.length, 1);
  const oldId = w.transfers[0].id;
  console.log("T-001 draft created", oldId);
  await readiness(oldId);
  w = await ward();
  const old = w.transfers[0];
  assert.equal(old.offer?.porterId, "porter-1");
  assert.equal(old.offer.status, "pending");
  assert.equal(old.phase, "OFFERING");
  const slow = old.offer;
  console.log("T-001 offered to Samir; not assigned");
  await sleep(4000);
  stage = "timeout and interrupt";
  await api("sandbox/playback", { advance: 60 });
  await role("nurse");
  await api("messages", {
    text: "Wait—cancel Bed 18. Bed 21 needs transport to CT instead.",
    transferId: oldId,
  });
  await drain();
  w = await ward();
  const proposal = w.replacements?.find((p) => p.oldTransferId === oldId);
  assert.ok(proposal);
  assert.equal(proposal.patientId, "enc-05");
  assert.equal(proposal.destinationName, "CT");
  assert.equal(w.transfers.length, 1);
  console.log("Timeout and replacement proposed; nurse confirmation required");
  await sleep(4000);
  await api(`replacements/${proposal.id}/confirm`, {});
  w = await ward();
  assert.equal(w.transfers[0].control, "CANCELLED");
  assert.equal(w.transfers.length, 2);
  const newId = w.transfers[1].id;
  console.log("T-001 CANCELLED; T-002 created", newId);
  await sleep(4000);
  stage = "late acceptance";
  await role("porter");
  const late = await api(`transfers/${oldId}/commands`, {
    type: "ACCEPT",
    expectedRevision: slow.revision,
    payload: { offerId: slow.id },
  });
  assert.equal(late.rejected, true);
  w = await ward();
  assert.equal(w.transfers[0].control, "CANCELLED");
  assert.ok(w.transfers[0].offers.every((o) => o.status !== "accepted"));
  assert.equal(w.transfers.length, 2);
  console.log("Samir late acceptance rejected:", late.message);
  await sleep(4000);
  stage = "replacement";
  await role("coordinator");
  await api("scenarios", { scenario: "stale_availability" });
  await readiness(newId);
  w = await ward();
  const replacement = w.transfers[1];
  assert.equal(replacement.offer?.porterId, "porter-2");
  assert.equal(replacement.phase, "OFFERING");
  assert.equal(replacement.offer.status, "pending");
  console.log("T-002 offered to Leena; still unassigned");
  await sleep(4000);
  await role("porter");
  await cmd(newId, "ACCEPT", { offerId: replacement.offer.id });
  assert.equal((await ward()).transfers[1].phase, "ASSIGNED");
  console.log("Leena explicitly accepted; T-002 ASSIGNED");
  await sleep(4000);
  stage = "handoff";
  await cmd(newId, "COLLECT");
  assert.equal((await ward()).transfers[1].phase, "COLLECTED");
  await sleep(3000);
  await cmd(newId, "ARRIVE");
  assert.equal((await ward()).transfers[1].phase, "ARRIVED");
  console.log("Arrived at CT; not complete before receiver acknowledgement");
  await sleep(4000);
  await role("receiving");
  await cmd(newId, "HANDOFF");
  w = await ward();
  assert.equal(w.transfers[1].phase, "COMPLETED");
  assert.equal(w.transfers[0].control, "CANCELLED");
  assert.ok(w.transfers[0].offers.every((o) => o.status !== "accepted"));
  assert.equal(w.transfers.length, 2);
  await writeFile(
    "evidence/stale-http-result.json",
    JSON.stringify(
      {
        passed: true,
        sessionId: w.testSessionId,
        health,
        late,
        aliases: { "T-001": oldId, "T-002": newId },
        failedAssertions: [],
        final: w,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      sessionId: w.testSessionId,
      cost: w.cost,
      modelCalls: w.transfers.map((t) => t.modelCalls),
      late,
    }),
  );
} catch (e) {
  await writeFile(
    "evidence/stale-http-failure.json",
    JSON.stringify({ stage, error: String(e), final: await ward() }, null, 2),
  );
  throw e;
}
