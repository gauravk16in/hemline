import { it, expect } from "vitest";
import {
  seed,
  createDraft,
  command,
  offer,
  advance,
  addMessage,
  proposeReplacement,
  confirmReplacement,
  reconcileAcceptance,
  destinationDelay,
  propose,
  confirmProposal,
} from "../lib/domain";
it("times out, interrupts, rejects late acceptance and verifies the independent CT handoff", () => {
  const w = seed();
  const old = createDraft(w, "enc-04", w.now + 1800000);
  const act = (
    id: string,
    type: Parameters<typeof command>[2]["type"],
    role: Parameters<typeof command>[3],
    payload = {},
  ) =>
    command(
      w,
      id,
      {
        type,
        expectedRevision: w.transfers.find((t) => t.id === id)!.revision,
        payload,
      },
      role,
    );
  act(old.id, "CONFIRM_REQUEST", "nurse");
  for (const requirement of ["nurse", "escort", "receiving"])
    act(
      old.id,
      "CONFIRM_READINESS",
      requirement === "receiving" ? "receiving" : "nurse",
      { requirement },
    );
  const slow = offer(w, old.id, old.revision, "porter-1");
  expect(old.phase).toBe("OFFERING");
  expect(old.offer?.status).toBe("pending");
  advance(w, 46);
  expect(slow.status).toBe("expired");
  expect(old.control).toBe("ACTIVE");
  const m = addMessage(
    w,
    "Wait—cancel Bed 18. Bed 21 needs transport to CT instead.",
    "nurse",
    old.id,
  );
  expect(old.control).toBe("PAUSED");
  expect(() => offer(w, old.id, old.revision, "porter-2")).toThrow();
  const p = proposeReplacement(
    w,
    m.id,
    old.id,
    "enc-05",
    "CT",
    w.now + 1800000,
  );
  expect(w.transfers).toHaveLength(1);
  expect(() => confirmReplacement(w, p.id, "porter")).toThrow();
  confirmReplacement(w, p.id, "nurse");
  const valid = w.transfers.find((t) => t.id === p.newTransferId)!;
  expect(old.control).toBe("CANCELLED");
  expect(valid.destinationName).toBe("CT");
  expect(valid.confirmations).toEqual({});
  expect(valid.phase).toBe("DRAFT");
  expect(() => createDraft(w, "enc-05", w.now + 1800000, "CT")).toThrow();
  const result = reconcileAcceptance(
    w,
    old.id,
    slow.id,
    slow.revision,
    "porter",
  );
  expect(result.rejected).toBe(true);
  expect(old.control).toBe("CANCELLED");
  expect(old.offer?.status).not.toBe("accepted");
  expect(w.porterNotifications?.[0].porterId).toBe("porter-1");
  act(valid.id, "CONFIRM_REQUEST", "nurse");
  for (const requirement of ["nurse", "escort", "receiving"])
    act(
      valid.id,
      "CONFIRM_READINESS",
      requirement === "receiving" ? "receiving" : "nurse",
      { requirement },
    );
  // Radiology delays must not revoke CT readiness.
  destinationDelay(w, 15, "receiving");
  expect(valid.control).toBe("ACTIVE");
  const accepted = offer(w, valid.id, valid.revision, "porter-2");
  reconcileAcceptance(w, valid.id, accepted.id, valid.revision, "porter");
  expect(valid.phase).toBe("ASSIGNED");
  act(valid.id, "COLLECT", "porter");
  act(valid.id, "ARRIVE", "porter");
  expect(valid.phase).toBe("ARRIVED");
  expect(() => act(valid.id, "HANDOFF", "porter")).toThrow();
  act(valid.id, "HANDOFF", "receiving");
  expect(valid.phase).toBe("COMPLETED");
  expect(valid.handoffEvidence?.actor).toBe("receiving");
  expect(
    w.events.every((e) => e.id && e.realAt && typeof e.at === "number"),
  ).toBe(true);
});
it("requires accepted porter cancellation acknowledgement before creating replacement", () => {
  const w = seed();
  const old = createDraft(w, "enc-04", w.now + 1800000);
  old.phase = "READY";
  old.confirmations = { nurse: true, escort: true, receiving: true };
  const o = offer(w, old.id, old.revision, "porter-1");
  reconcileAcceptance(w, old.id, o.id, old.revision, "porter");
  const m = addMessage(
    w,
    "Cancel this, use Bed 21 CT instead",
    "nurse",
    old.id,
  );
  const p = proposeReplacement(
    w,
    m.id,
    old.id,
    "enc-05",
    "CT",
    w.now + 1800000,
  );
  expect(confirmReplacement(w, p.id, "nurse")).toMatchObject({ waiting: true });
  expect(w.transfers).toHaveLength(1);
  command(
    w,
    old.id,
    { type: "ACK_CANCEL", expectedRevision: old.revision, payload: {} },
    "porter",
  );
  confirmReplacement(w, p.id, "nurse");
  expect(old.control).toBe("CANCELLED");
  expect(w.transfers).toHaveLength(2);
});
it("refuses replacement after collection and rejects an old offer without changing a newer assignment", () => {
  const w = seed();
  const t = createDraft(w, "enc-04", w.now + 1800000);
  t.phase = "READY";
  t.confirmations = { nurse: true, escort: true, receiving: true };
  const expired = offer(w, t.id, t.revision, "porter-1");
  advance(w, 46);
  const current = offer(w, t.id, t.revision, "porter-2");
  reconcileAcceptance(w, t.id, current.id, t.revision, "porter");
  expect(
    reconcileAcceptance(w, t.id, expired.id, expired.revision, "porter")
      .rejected,
  ).toBe(true);
  expect(t.offer?.porterId).toBe("porter-2");
  expect(t.phase).toBe("ASSIGNED");
  command(
    w,
    t.id,
    { type: "COLLECT", expectedRevision: t.revision, payload: {} },
    "porter",
  );
  const m = addMessage(w, "Cancel and replace with Bed 21 CT", "nurse", t.id);
  expect(() =>
    proposeReplacement(w, m.id, t.id, "enc-05", "CT", w.now + 1800000),
  ).toThrow();
  expect(t.phase).toBe("COLLECTED");
  expect(w.transfers).toHaveLength(1);
});
it("CT destination changes affect CT without changing Radiology readiness", () => {
  const w = seed();
  const radio = createDraft(w, "enc-04", w.now + 1800000, "Radiology");
  const ct = createDraft(w, "enc-05", w.now + 1800000, "CT");
  for (const t of [radio, ct]) {
    t.phase = "READY";
    t.confirmations = { nurse: true, escort: true, receiving: true };
  }
  destinationDelay(w, 15, "receiving", "visitor", "CT");
  expect(ct.control).toBe("PAUSED");
  expect(radio.control).toBe("ACTIVE");
  expect(w.ctDestination?.revision).toBe(2);
  expect(w.destination.revision).toBe(1);
});

it("auto-confirmed readiness does not queue duplicate model activations", () => {
  const w = seed();
  const t = createDraft(w, "enc-04", w.now + 1800000);
  command(
    w,
    t.id,
    { type: "CONFIRM_REQUEST", expectedRevision: t.revision, payload: {} },
    "nurse",
  );
  const m = addMessage(
    w,
    "Patient ready and escort confirmed",
    "nurse",
    t.id,
    "simulated staff",
  );
  const before = w.runs.length;
  for (const requirement of ["nurse", "escort"] as const) {
    const p = propose(w, m.id, {
      kind: "readiness",
      targetId: t.id,
      requirement,
      decision: true,
      delayMinutes: null,
      excerpt: "confirmed",
      uncertain: false,
      question: null,
    });
    confirmProposal(w, p.id, "nurse", false);
  }
  expect(w.runs).toHaveLength(before);
  expect(t.confirmations).toMatchObject({ nurse: true, escort: true });
});

it("accepts receiving readiness under its source role and explains wrong update types", () => {
  const w = seed();
  const t = createDraft(w, "enc-04", w.now + 1800000);
  command(
    w,
    t.id,
    { type: "CONFIRM_REQUEST", expectedRevision: t.revision, payload: {} },
    "nurse",
  );
  const m = addMessage(
    w,
    "Radiology is ready to receive",
    "receiving",
    t.id,
    "simulated staff",
  );
  const fields = {
    targetId: t.id,
    requirement: "receiving" as const,
    decision: true,
    delayMinutes: null,
    excerpt: "ready",
    uncertain: false,
    question: null,
  };
  const wrong = propose(w, m.id, { ...fields, kind: "availability" });
  expect(() => confirmProposal(w, wrong.id, "receiving", false)).toThrow(
    "kind=readiness",
  );
  const valid = propose(w, m.id, { ...fields, kind: "readiness" });
  confirmProposal(w, valid.id, "receiving", false);
  expect(t.confirmations.receiving).toBe(true);
  expect(t.readinessEvidence?.receiving?.actor).toBe("receiving");
});
it("distinguishes a wrong offer ID from expiry and requires reconciliation before reoffering", () => {
  const w = seed();
  const t = createDraft(w, "enc-04", w.now + 1800000);
  t.phase = "READY";
  t.confirmations = { nurse: true, escort: true, receiving: true };
  const first = offer(w, t.id, t.revision, "porter-1");
  expect(() =>
    command(
      w,
      t.id,
      {
        type: "REJECT",
        expectedRevision: t.revision,
        payload: { offerId: t.id },
      },
      "porter",
    ),
  ).toThrow("Offer response must use offer ID");
  expect(() => offer(w, t.id, t.revision, "porter-2")).toThrow("reconcile");
  command(
    w,
    t.id,
    {
      type: "REJECT",
      expectedRevision: t.revision,
      payload: { offerId: first.id },
    },
    "porter",
  );
  expect(t.confirmations).toEqual({
    nurse: true,
    escort: true,
    receiving: true,
  });
  expect(offer(w, t.id, t.revision, "porter-2").status).toBe("pending");
});
it("resolves a confirmed receiving delay through its bound CT transfer", () => {
  const w = seed();
  const radio = createDraft(w, "enc-04", w.now + 1800000, "Radiology");
  const ct = createDraft(w, "enc-05", w.now + 1800000, "CT");
  const m = addMessage(w, "Scanner delayed 15 minutes", "receiving", ct.id);
  const p = propose(w, m.id, {
    kind: "destination_delay",
    targetId: ct.id,
    requirement: null,
    decision: null,
    delayMinutes: 15,
    excerpt: "delayed 15 minutes",
    uncertain: false,
    question: null,
  });
  confirmProposal(w, p.id, "receiving");
  expect(w.ctDestination?.revision).toBe(2);
  expect(ct.control).toBe("PAUSED");
  expect(radio.control).toBe("ACTIVE");
  expect(w.destination.revision).toBe(1);
});
