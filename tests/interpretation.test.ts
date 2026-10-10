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
