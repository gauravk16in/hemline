import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createSandbox,
  resetLocalTestWard,
  mutate,
  readWard,
  claim,
  finish,
  reserve,
  settle,
  backend,
} from "../lib/store";
import {
  createDraft,
  queueRun,
  command,
  offer,
  eligible,
  advance,
  reconcileAcceptance,
} from "../lib/domain";
describe("PostgreSQL transactions", () => {
  it("isolates sandboxes and persists committed state", async () => {
    const owner = randomUUID();
    const w = await createSandbox(owner);
    await mutate(w.id, owner, (w) => {
      createDraft(w, "enc-04", w.now + 1800000);
    });
    expect((await readWard(w.id, owner)).transfers).toHaveLength(1);
    await expect(readWard(w.id, "other")).rejects.toThrow();
    await expect(
      mutate(w.id, "other", (w) => {
        w.role = "coordinator";
      }),
    ).rejects.toThrow();
  });
  it("rolls back partial mutations on error", async () => {
    const owner = randomUUID(),
      w = await createSandbox(owner);
    await expect(
      mutate(w.id, owner, (w) => {
        w.role = "porter";
        throw Error("failure");
      }),
    ).rejects.toThrow();
    expect((await readWard(w.id, owner)).role).toBe("nurse");
  });
  it("leases once and fences stale workers", async () => {
    const owner = randomUUID(),
      w = await createSandbox(owner);
    await mutate(w.id, owner, (w) => {
      queueRun(w, "test", "nurse");
    });
    const job = await claim();
    expect(job).not.toBeNull();
    expect(await claim()).toBeNull();
    await mutate(
      w.id,
      null,
      (w) => {
        w.role = "porter";
      },
      job!.token,
    );
    await finish(job!.token);
    await expect(
      mutate(
        w.id,
        null,
        (w) => {
          w.role = "nurse";
        },
        job!.token,
      ),
    ).rejects.toThrow("lease");
  });
  it("atomically prevents racing duplicate offers", async () => {
    const owner = randomUUID(),
      w = await createSandbox(owner);
    const tid = await mutate(w.id, owner, (w) => {
      const t = createDraft(w, "enc-04", w.now + 1800000);
      command(
        w,
        t.id,
        { type: "CONFIRM_REQUEST", expectedRevision: 1, payload: {} },
        "nurse",
      );
      for (const r of ["nurse", "escort", "receiving"])
        command(
          w,
          t.id,
          {
            type: "CONFIRM_READINESS",
            expectedRevision: 1,
            payload: { requirement: r },
          },
          r === "receiving" ? "receiving" : "nurse",
        );
      return t.id;
    });
    const results = await Promise.allSettled([
      mutate(w.id, owner, (w) => offer(w, tid, 1, "porter-1")),
      mutate(w.id, owner, (w) => offer(w, tid, 1, "porter-2")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await readWard(w.id, owner)).transfers[0].offers).toHaveLength(1);
  });
  it("reserves and settles budget exactly once", async () => {
    const owner = randomUUID(),
      w = await createSandbox(owner);
    const key = await reserve(w.id, 0.1);
    expect((await readWard(w.id, owner)).cost).toBeCloseTo(0.1);
    await settle(key, 0.02);
    await settle(key, 0);
    expect((await readWard(w.id, owner)).cost).toBeCloseTo(0.02);
    await expect(reserve(w.id, 1.1)).rejects.toThrow("budget");
  });
  it("can reclaim expired lease without allowing old token writes", async () => {
    const owner = randomUUID(),
      w = await createSandbox(owner);
    await mutate(w.id, owner, (w) => {
      queueRun(w, "recover", "nurse");
    });
    const job = await claim();
    const b = await backend();
    await b.db.query(
      "update hemline_jobs set lease_until=now()-interval '1 second' where id=$1",
      [job!.id],
    );
    const newer = await claim();
    expect(newer!.token).not.toBe(job!.token);
    await expect(mutate(w.id, null, () => true, job!.token)).rejects.toThrow();
    await finish(newer!.token);
  });
});

it("retains rejection history after PostgreSQL serialization", async () => {
  const owner = randomUUID(),
    w = await createSandbox(owner);
  const tid = await mutate(w.id, owner, (w) => {
    const t = createDraft(w, "enc-04", w.now + 1800000);
    command(
      w,
      t.id,
      { type: "CONFIRM_REQUEST", expectedRevision: 1, payload: {} },
      "nurse",
    );
    for (const r of ["nurse", "escort", "receiving"])
      command(
        w,
        t.id,
        {
          type: "CONFIRM_READINESS",
          expectedRevision: 1,
          payload: { requirement: r },
        },
        r === "receiving" ? "receiving" : "nurse",
      );
    offer(w, t.id, 1, "porter-1");
    return t.id;
  });
  await mutate(w.id, owner, (w) => {
    const t = w.transfers[0];
    command(
      w,
      tid,
      {
        type: "REJECT",
        expectedRevision: 1,
        payload: { offerId: t.offer!.id },
      },
      "porter",
    );
  });
  const saved = await readWard(w.id, owner);
  expect(eligible(saved, saved.transfers[0]).map((p) => p.id)).not.toContain(
    "porter-1",
  );
});

it("rejects invalid cost reservations before opening a transaction", async () => {
  await expect(reserve(randomUUID(), -1)).rejects.toThrow("Invalid cost");
  await expect(reserve(randomUUID(), Number.NaN)).rejects.toThrow(
    "Invalid cost",
  );
});

it("keeps public quota at 25 cents while allowing a private demo above it", async () => {
  const owner = randomUUID();
  const w = await createSandbox(owner);
  await mutate(w.id, owner, (w) => {
    w.cost = 0.217;
  });
  try {
    vi.stubEnv("PUBLIC_DEMO_ENABLED", "true");
    await expect(reserve(w.id, 0.0363)).rejects.toThrow(
      "Sandbox model budget exhausted",
    );
    vi.stubEnv("PUBLIC_DEMO_ENABLED", "false");
    const b = await backend();
    const before = await b.db.query<{ public_used: string }>(
      "select public_used from hemline_budget where id=1",
    );
    const reservation = await reserve(w.id, 0.0363);
    expect((await readWard(w.id, owner)).cost).toBeCloseTo(0.2533);
    await settle(reservation, 0.01);
    const after = await b.db.query<{ public_used: string }>(
      "select public_used from hemline_budget where id=1",
    );
    expect(Number(after.rows[0].public_used)).toBe(
      Number(before.rows[0].public_used),
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

it("persists a rejected stale acceptance and its notification atomically", async () => {
  const owner = randomUUID();
  const w = await createSandbox(owner);
  const ids = await mutate(w.id, owner, (w) => {
    const t = createDraft(w, "enc-04", w.now + 1800000);
    t.phase = "READY";
    t.confirmations = { nurse: true, escort: true, receiving: true };
    const o = offer(w, t.id, t.revision, "porter-1");
    advance(w, 46);
    command(
      w,
      t.id,
      { type: "CANCEL", expectedRevision: t.revision, payload: {} },
      "nurse",
    );
    return { transferId: t.id, offerId: o.id, revision: o.revision };
  });
  await mutate(w.id, owner, (w) =>
    reconcileAcceptance(w, ids.transferId, ids.offerId, ids.revision, "porter"),
  );
  const saved = await readWard(w.id, owner);
  expect(saved.transfers[0].control).toBe("CANCELLED");
  expect(saved.transfers[0].offer?.status).not.toBe("accepted");
  expect(saved.porterNotifications).toHaveLength(1);
  expect(saved.events.some((e) => e.text.includes("discarded"))).toBe(true);
});

it("claims queued messages in arrival order within a sandbox", async () => {
  const owner = randomUUID();
  const w = await createSandbox(owner);
  const ids: string[] = [];
  for (const text of ["nurse ready", "receiving ready", "dispatch"]) {
    ids.push(await mutate(w.id, owner, (w) => queueRun(w, text, "nurse").id));
  }
  for (const id of ids) {
    const job = await claim(w.id);
    expect(job?.run_id).toBe(id);
    await finish(job!.token);
  }
});

it("resets only a named test ward and preserves unrelated wards and global costs", async () => {
  const visitorOwner = randomUUID();
  const visitor = await createSandbox(visitorOwner);
  await mutate(visitor.id, visitorOwner, (w) =>
    createDraft(w, "enc-04", w.now + 1800000),
  );
  const b = await backend();
  const before = await b.db.query(
    "select used,public_used from hemline_budget where id=1",
  );
  const owner = randomUUID();
  const first = await resetLocalTestWard(owner, "isolated-reset-test");
  await b.db.query(
    "update hemline_sandboxes set state=jsonb_set(state,'{transfers}',$2::jsonb) where id=$1",
    [
      first.id,
      JSON.stringify((await readWard(visitor.id, visitorOwner)).transfers),
    ],
  );
  const reset = await resetLocalTestWard(owner, "isolated-reset-test");
  expect(reset.id).toBe(first.id);
  expect(reset.transfers).toHaveLength(0);
  expect((await readWard(visitor.id, visitorOwner)).transfers).toHaveLength(1);
  expect(
    (await b.db.query("select used,public_used from hemline_budget where id=1"))
      .rows,
  ).toEqual(before.rows);
  await expect(
    resetLocalTestWard(visitorOwner, "isolated-reset-test"),
  ).rejects.toThrow("non-test ward");
  await expect(resetLocalTestWard(owner, "different-test")).rejects.toThrow(
    "non-test ward",
  );
});
