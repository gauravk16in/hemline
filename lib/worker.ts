import { allIds, mutate, claim, finish, heartbeat } from "./store";
import { activate } from "./agent";
import { advance, event, findTransfer } from "./domain";
let busy = false;
export async function tick() {
  if (busy) return { busy: true };
  busy = true;
  try {
    await heartbeat();
    for (const id of await allIds()) {
      await mutate(id, null, (w) => {
        const realNow = Date.now();
        const elapsed = Math.min(1000, Math.max(0, realNow - w.lastTick));
        w.lastTick = realNow;
        if (!w.paused) advance(w, elapsed / 1000);
      });
    }
    const job = await claim();
    if (!job) return { idle: true };
    try {
      await activate(job.sandbox_id, job.token, job.run_id);
      await finish(job.token);
    } catch (error) {
      await mutate(
        job.sandbox_id,
        null,
        (w) => {
          const r = w.runs.find((r) => r.id === job.run_id);
          if (r) {
            r.status = "error";
            r.summary =
              error instanceof Error ? error.message : "Activation failed";
            if (r.transferId) {
              const t = findTransfer(w, r.transferId);
              t.owner = "coordinator";
              t.control = ["COLLECTED", "ARRIVED"].includes(t.phase)
                ? "ESCALATED"
                : "PAUSED";
              t.nextAction =
                "Agent unavailable; coordinator can take ownership";
            }
            event(
              w,
              r.summary,
              "backend",
              r.transferId ? findTransfer(w, r.transferId) : null,
              "backend",
            );
          }
        },
        job.token,
      ).catch(() => {});
      await finish(job.token, "error");
    }
    return { processed: job.run_id };
  } finally {
    busy = false;
  }
}
