import { describe, it, expect } from "vitest";
import { backend } from "../lib/store";
import {
  schedulerStart,
  schedulerLease,
  schedulerEnd,
  schedulerCheck,
} from "../lib/scheduler";
describe("Lambda scheduler fencing", () => {
  it("admits one scheduler, fences stale owners, and permits explicit handoff", async () => {
    const b = await backend();
    await b.db.query("delete from hemline_scheduler");
    const first = await schedulerStart();
    expect(first.token).toBeTruthy();
    expect((await schedulerStart()).token).toBeNull();
    expect((await schedulerLease(first.token!, "owner-a")).owned).toBe(true);
    await expect(schedulerLease(first.token!, "owner-b")).rejects.toThrow(
      "still active",
    );
    await expect(schedulerCheck(first.token!, "owner-b")).rejects.toThrow(
      "superseded",
    );
    await schedulerEnd(first.token!, "owner-b", false);
    await schedulerCheck(first.token!, "owner-a");
    await schedulerEnd(first.token!, "owner-a", true);
    expect((await schedulerLease(first.token!, "owner-b")).owned).toBe(true);
    await schedulerEnd(first.token!, "owner-b", false);
    const next = await schedulerStart();
    expect(next.token).not.toBe(first.token);
    expect((await schedulerLease(first.token!, "owner-a")).owned).toBe(false);
    await expect(schedulerCheck(first.token!, "owner-a")).rejects.toThrow(
      "superseded",
    );
  });
  it("recovers expired lease without admitting parallel owners", async () => {
    const b = await backend();
    await b.db.query(
      "update hemline_scheduler set lease_until=now()-interval '1 second'",
    );
    const next = await schedulerStart();
    expect((await schedulerLease(next.token!, "crashed")).owned).toBe(true);
    await b.db.query(
      "update hemline_scheduler set lease_until=now()-interval '1 second'",
    );
    expect((await schedulerLease(next.token!, "retry")).owned).toBe(true);
    await expect(schedulerCheck(next.token!, "crashed")).rejects.toThrow();
  });
});
