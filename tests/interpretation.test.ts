import { it, expect } from "vitest";
import { fixtureInterpret } from "../lib/agent";
import { seed, createDraft, addMessage } from "../lib/domain";
it("ambiguous staff language becomes clarification in fixture adapter", () => {
  const w = seed(),
    t = createDraft(w, "enc-04", w.now + 1800000);
  const m = addMessage(w, "Probably ready in ten minutes.", "nurse", t.id);
  const actions = fixtureInterpret(
    w,
    w.runs.find((r) => r.messageId === m.id)!,
  );
  expect(actions[0].args.uncertain).toBe(true);
});
it("maps destination delay to an explicit proposal", () => {
  const w = seed(),
    t = createDraft(w, "enc-04", w.now + 1800000);
  const m = addMessage(w, "Scanner delayed 15 minutes.", "receiving", t.id);
  const actions = fixtureInterpret(
    w,
    w.runs.find((r) => r.messageId === m.id)!,
  );
  expect(actions[0].args.kind).toBe("destination_delay");
  expect(actions[0].args.delayMinutes).toBe(15);
});

it("fixture replacement resolves the second bed and CT without changing readiness", () => {
  const w = seed(),
    t = createDraft(w, "enc-04", w.now + 1800000);
  const m = addMessage(
    w,
    "Wait—cancel Bed 18. Bed 21 needs transport to CT instead.",
    "nurse",
    t.id,
  );
  const actions = fixtureInterpret(
    w,
    w.runs.find((r) => r.messageId === m.id)!,
  );
  expect(actions[0]).toMatchObject({
    name: "propose_replacement",
    args: { patientId: "enc-05", destinationName: "CT" },
  });
  expect(w.transfers).toHaveLength(1);
});
