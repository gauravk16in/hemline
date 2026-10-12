import { describe, it, expect } from "vitest";
import {
  seed,
  createDraft,
  command,
  offer,
  advance,
  eligible,
  destinationDelay,
  addMessage,
  propose,
  confirmProposal,
  type Ward,
  type Transfer,
  type Command,
  type Role,
} from "../lib/domain";
function act(
  w: Ward,
  t: Transfer,
  type: Command["type"],
  role: Role,
  payload: Record<string, unknown> = {},
) {
  return command(
    w,
    t.id,
    { type, expectedRevision: t.revision, payload },
    role,
  );
}
function prepared() {
  const w = seed();
  const t = createDraft(w, "enc-04", w.now + 1800000);
  act(w, t, "CONFIRM_REQUEST", "nurse");
  for (const r of ["nurse", "escort", "receiving"])
    act(w, t, "CONFIRM_READINESS", r === "receiving" ? "receiving" : "nurse", {
      requirement: r,
    });
  return { w, t };
}
describe("verified transfers", () => {
  it("names CT in the pickup-to-arrival instruction", () => {
    const w = seed();
    const t = createDraft(w, "enc-05", w.now + 1800000, "CT");
    act(w, t, "CONFIRM_REQUEST", "nurse");
    for (const requirement of ["nurse", "escort", "receiving"])
      act(
        w,
        t,
        "CONFIRM_READINESS",
        requirement === "receiving" ? "receiving" : "nurse",
        { requirement },
      );
    const o = offer(w, t.id, t.revision, "porter-2");
    act(w, t, "ACCEPT", "porter", { offerId: o.id });
    act(w, t, "COLLECT", "porter");
    expect(t.nextAction).toBe("Record arrival at CT");
    expect(t.phase).toBe("COLLECTED");
  });
  it("requires independent pickup, arrival, and receiving acknowledgement", () => {
    const { w, t } = prepared();
    const o = offer(w, t.id, t.revision, "porter-1");
    expect(t.phase).toBe("OFFERING");
    act(w, t, "ACCEPT", "porter", { offerId: o.id });
    expect(t.phase).toBe("ASSIGNED");
    expect(() => act(w, t, "HANDOFF", "receiving")).toThrow();
    act(w, t, "COLLECT", "porter");
    act(w, t, "ARRIVE", "porter");
    expect(t.phase).toBe("ARRIVED");
    act(w, t, "HANDOFF", "receiving");
    expect(t.phase).toBe("COMPLETED");
  });
  it("will not dispatch an unapproved or unready request", () => {
    const w = seed(),
      t = createDraft(w, "enc-04", w.now + 1800000);
    expect(() => offer(w, t.id, t.revision, "porter-1")).toThrow();
    act(w, t, "CONFIRM_REQUEST", "nurse");
    expect(() => offer(w, t.id, t.revision, "porter-1")).toThrow();
  });
  it("does not let agent approve readiness or accept offers", () => {
    const { w, t } = prepared();
    expect(() =>
      command(
        w,
        t.id,
        {
          type: "CONFIRM_READINESS",
          expectedRevision: t.revision,
          payload: { requirement: "nurse" },
        },
        "agent",
      ),
    ).toThrow();
    const o = offer(w, t.id, t.revision, "porter-1");
    expect(() =>
      command(
        w,
        t.id,
        {
          type: "ACCEPT",
          expectedRevision: t.revision,
          payload: { offerId: o.id },
        },
        "agent",
      ),
    ).toThrow();
  });
  it("rejects wrong staff role", () => {
    const { w, t } = prepared();
    expect(() =>
      act(w, t, "WITHDRAW_READINESS", "porter", { requirement: "nurse" }),
    ).toThrow();
  });
  it("recovers after rejection with another candidate", () => {
    const { w, t } = prepared();
    const o = offer(w, t.id, t.revision, "porter-1");
    act(w, t, "REJECT", "porter", { offerId: o.id });
    expect(eligible(w, t).map((s) => s.id)).not.toContain("porter-1");
    offer(w, t.id, t.revision, "porter-2");
    expect(t.offers).toHaveLength(2);
  });
  it("rejects expired and late acceptance", () => {
    const { w, t } = prepared();
    const o = offer(w, t.id, t.revision, "porter-1");
    advance(w, 45);
    expect(o.status).toBe("expired");
    expect(() => act(w, t, "ACCEPT", "porter", { offerId: o.id })).toThrow();
  });
  it("rejects availability changes between lookup and dispatch", () => {
    const { w, t } = prepared();
    expect(eligible(w, t)).toHaveLength(3);
    w.staff[0].available = false;
    expect(() => offer(w, t.id, t.revision, "porter-1")).toThrow();
  });
  it("does not double-book a porter", () => {
    const { w, t } = prepared();
    offer(w, t.id, t.revision, "porter-1");
    const other = createDraft(w, "enc-03", w.now + 1800000);
    act(w, other, "CONFIRM_REQUEST", "nurse");
    for (const r of ["nurse", "escort", "receiving"])
      act(
        w,
        other,
        "CONFIRM_READINESS",
        r === "receiving" ? "receiving" : "nurse",
        { requirement: r },
      );
    expect(() => offer(w, other.id, other.revision, "porter-1")).toThrow();
  });
  it("rejects a duplicate offer", () => {
    const { w, t } = prepared();
    offer(w, t.id, t.revision, "porter-1");
    expect(() => offer(w, t.id, t.revision, "porter-2")).toThrow();
  });
  it("withdrawal reconciles an accepted assignment", () => {
    const { w, t } = prepared();
    const o = offer(w, t.id, t.revision, "porter-1");
    act(w, t, "ACCEPT", "porter", { offerId: o.id });
    act(w, t, "WITHDRAW_READINESS", "nurse", { requirement: "nurse" });
    expect(t.control).toBe("CANCELLING");
    expect(() => act(w, t, "COLLECT", "porter")).toThrow();
  });
  it("requires cancellation acknowledgement before rescheduling", () => {
    const { w, t } = prepared();
    const o = offer(w, t.id, t.revision, "porter-1");
    act(w, t, "ACCEPT", "porter", { offerId: o.id });
    destinationDelay(w, 15, "receiving");
    expect(t.control).toBe("CANCELLING");
    expect(() =>
      act(w, t, "CONFIRM_RESCHEDULE", "nurse", {
        appointment: w.destination.availableAfter,
      }),
    ).toThrow();
    act(w, t, "ACK_CANCEL", "porter");
    act(w, t, "CONFIRM_RESCHEDULE", "nurse", {
      appointment: w.destination.availableAfter,
    });
    expect(t.revision).toBe(2);
    expect(t.confirmations).toEqual({});
    expect(o.status).toBe("cancelled");
  });
  it("destination delay blocks pending dispatch and queues replanning", () => {
    const { w, t } = prepared();
    const o = offer(w, t.id, t.revision, "porter-1");
    destinationDelay(w, 15, "receiving");
    expect(o.status).toBe("cancelled");
    expect(t.control).toBe("PAUSED");
    expect(w.runs.at(-1)?.text).toContain("Destination changed");
  });
  it("rejects impossible receiving window", () => {
    const { w, t } = prepared();
    destinationDelay(w, 240, "receiving");
    expect(() =>
      act(w, t, "CONFIRM_RESCHEDULE", "nurse", {
        appointment: w.destination.availableAfter,
      }),
    ).toThrow();
  });
  it("does not reverse a collected transfer on cancellation", () => {
    const { w, t } = prepared();
    const o = offer(w, t.id, t.revision, "porter-1");
    act(w, t, "ACCEPT", "porter", { offerId: o.id });
    act(w, t, "COLLECT", "porter");
    act(w, t, "CANCEL", "nurse");
    expect(t.phase).toBe("COLLECTED");
    expect(t.control).toBe("ESCALATED");
  });
  it("late amendment cannot use an obsolete revision", () => {
    const { w, t } = prepared();
    act(w, t, "SET_REQUIREMENT", "nurse", { requirement: "oxygen" });
    expect(() =>
      command(
        w,
        t.id,
        {
          type: "CONFIRM_READINESS",
          expectedRevision: 1,
          payload: { requirement: "nurse" },
        },
        "nurse",
      ),
    ).toThrow();
  });
  it("enforces required oxygen equipment and porter capability", () => {
    const { w, t } = prepared();
    act(w, t, "SET_REQUIREMENT", "nurse", { requirement: "oxygen" });
    act(w, t, "RESUME", "coordinator");
    expect(() => offer(w, t.id, t.revision, "porter-2")).toThrow();
    for (const r of ["nurse", "escort", "receiving", "oxygen"])
      act(
        w,
        t,
        "CONFIRM_READINESS",
        r === "receiving" ? "receiving" : "nurse",
        { requirement: r },
      );
    expect(eligible(w, t).map((p) => p.id)).not.toContain("porter-3");
  });
  it("a paused clock cannot expire by wall time alone", () => {
    const { w, t } = prepared();
    offer(w, t.id, t.revision, "porter-1");
    expect(w.paused).toBe(true);
    w.lastTick -= 120000;
    expect(t.offer?.status).toBe("pending");
    advance(w, 30);
    expect(t.offer?.status).toBe("pending");
  });
  it("simulated actions are visibly labelled", () => {
    const w = seed();
    w.mode = "guided";
    const t = createDraft(w, "enc-04", w.now + 1800000);
    act(w, t, "CONFIRM_REQUEST", "nurse");
    advance(w, 5);
    expect(w.messages).toHaveLength(2);
    expect(w.messages.every((m) => m.source === "simulated staff")).toBe(true);
  });
  it("does not execute simulated staff after manual takeover", () => {
    const w = seed();
    w.mode = "guided";
    const t = createDraft(w, "enc-04", w.now + 1800000);
    act(w, t, "CONFIRM_REQUEST", "nurse");
    w.takenOver = ["nurse"];
    advance(w, 5);
    expect(w.messages.every((m) => m.role !== "nurse")).toBe(true);
  });
  it("does not treat uncertain interpretation as fact", () => {
    const { w, t } = prepared();
    const m = addMessage(w, "Probably ready in ten minutes.", "nurse", t.id);
    const p = propose(w, m.id, {
      kind: "readiness",
      targetId: t.id,
      requirement: "nurse",
      decision: true,
      delayMinutes: 10,
      excerpt: m.text,
      uncertain: true,
      question: "Confirm readiness?",
    });
    expect(() => confirmProposal(w, p.id, "nurse")).toThrow();
  });
  it("cannot invent evidence or let the wrong role confirm it", () => {
    const { w, t } = prepared();
    const m = addMessage(w, "Scanner delayed 15 minutes.", "receiving", t.id);
    const u = {
      kind: "destination_delay" as const,
      targetId: "radiology",
      requirement: null,
      decision: null,
      delayMinutes: 15,
      excerpt: "invented",
      uncertain: false,
      question: null,
    };
    expect(() => propose(w, m.id, u)).toThrow();
    const p = propose(w, m.id, { ...u, excerpt: m.text });
    expect(() => confirmProposal(w, p.id, "nurse")).toThrow();
    confirmProposal(w, p.id, "receiving");
    expect(w.destination.revision).toBe(2);
  });
  it("exhausts rejected candidates rather than retrying them", () => {
    const { w, t } = prepared();
    for (const s of [...w.staff]) {
      const o = offer(w, t.id, t.revision, s.id);
      act(w, t, "REJECT", "porter", { offerId: o.id });
    }
    expect(eligible(w, t)).toHaveLength(0);
  });
  it("caps visitor message intake", () => {
    const w = seed();
    for (let i = 0; i < 6; i++) addMessage(w, "Status?", "nurse", null);
    expect(() => addMessage(w, "Status?", "nurse", null)).toThrow();
  });
});

it("a verified handoff is final and cannot be cancelled afterward", () => {
  const { w, t } = prepared();
  const o = offer(w, t.id, t.revision, "porter-1");
  act(w, t, "ACCEPT", "porter", { offerId: o.id });
  act(w, t, "COLLECT", "porter");
  act(w, t, "ARRIVE", "porter");
  act(w, t, "HANDOFF", "receiving");
  expect(() => act(w, t, "CANCEL", "nurse")).toThrow("final");
});
it("readiness reminders and escalation follow simulation time", () => {
  const w = seed(),
    t = createDraft(w, "enc-04", w.now + 1800000);
  act(w, t, "CONFIRM_REQUEST", "nurse");
  advance(w, 60);
  expect(
    w.events.some((e) => e.text === "Readiness confirmation overdue"),
  ).toBe(true);
  expect(t.control).toBe("ACTIVE");
  advance(w, 60);
  expect(t.control).toBe("ESCALATED");
});
it("obsolete simulated replies cannot approve a changed revision", () => {
  const w = seed();
  w.mode = "guided";
  const t = createDraft(w, "enc-04", w.now + 1800000);
  act(w, t, "CONFIRM_REQUEST", "nurse");
  act(w, t, "SET_REQUIREMENT", "nurse", { requirement: "oxygen" });
  advance(w, 5);
  expect(w.messages).toHaveLength(0);
  expect(
    w.events.some((e) => e.text === "Obsolete simulated action discarded"),
  ).toBe(true);
});

it("retains readiness provenance and removes withdrawn evidence", () => {
  const w = seed();
  const t = createDraft(w, "enc-04", w.now + 1800000);
  command(
    w,
    t.id,
    { type: "CONFIRM_REQUEST", expectedRevision: t.revision, payload: {} },
    "nurse",
  );
  command(
    w,
    t.id,
    {
      type: "CONFIRM_READINESS",
      expectedRevision: t.revision,
      payload: { requirement: "nurse" },
    },
    "nurse",
    "simulated staff",
  );
  expect(JSON.parse(JSON.stringify(t)).readinessEvidence.nurse).toEqual({
    actor: "nurse",
    source: "simulated staff",
    at: w.now,
    revision: t.revision,
  });
  command(
    w,
    t.id,
    {
      type: "WITHDRAW_READINESS",
      expectedRevision: t.revision,
      payload: { requirement: "nurse" },
    },
    "nurse",
  );
  expect(t.confirmations.nurse).toBe(false);
  expect(t.readinessEvidence?.nurse).toBeUndefined();
});

it("cancelled transfers reject coordinator resume and takeover", () => {
  const w = seed();
  const t = createDraft(w, "enc-04", w.now + 1800000);
  command(
    w,
    t.id,
    { type: "CANCEL", expectedRevision: 1, payload: {} },
    "nurse",
  );
  for (const type of ["RESUME", "TAKEOVER"] as const)
    expect(() =>
      command(
        w,
        t.id,
        { type, expectedRevision: 1, payload: {} },
        "coordinator",
      ),
    ).toThrow("not active");
  expect(t.control).toBe("CANCELLED");
});

it("requires acknowledged safe resolution after collection and keeps the porter", () => {
  const { w, t } = prepared();
  const o = offer(w, t.id, t.revision, "porter-1");
  act(w, t, "ACCEPT", "porter", { offerId: o.id });
  act(w, t, "COLLECT", "porter");
  act(w, t, "CANCEL", "nurse");
  expect(() => act(w, t, "RESUME", "coordinator")).toThrow("safe resolution");
  expect(t.control).toBe("ESCALATED");
  act(w, t, "RESUME", "coordinator", {
    resolution:
      "Porter and receiver agreed to continue to the confirmed destination",
    acknowledged: true,
  });
  expect(t.phase).toBe("COLLECTED");
  expect(t.offer?.porterId).toBe("porter-1");
  expect(t.safeResolution?.actor).toBe("coordinator");
});
