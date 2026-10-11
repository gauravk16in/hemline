import { backend } from "./store";
import { randomUUID } from "node:crypto";
import { DomainError } from "./domain";

export async function schedulerStart() {
  const b = await backend();
  const token = randomUUID();
  const r = await b.db.query<{ token: string }>(
    `insert into hemline_scheduler(id,token,owner,lease_until) values(1,$1,null,now()+interval '240 seconds')
     on conflict(id) do update set token=$1,owner=null,lease_until=now()+interval '240 seconds'
     where hemline_scheduler.lease_until<now() returning token`,
    [token],
  );
  return { token: r.rows[0]?.token || null };
}
export async function schedulerLease(token: string, owner: string) {
  const b = await backend();
  const r = await b.db.query<{ token: string }>(
    `update hemline_scheduler set owner=$2,lease_until=now()+interval '150 seconds'
     where id=1 and token=$1 and (owner is null or owner=$2 or lease_until<now()) returning token`,
    [token, owner],
  );
  if (!r.rows.length) {
    const current = await b.db.query<{ token: string }>(
      "select token from hemline_scheduler where id=1",
      [],
    );
    if (current.rows[0]?.token === token)
      throw new DomainError(
        "SCHEDULER_BUSY",
        "Scheduler owner is still active",
        409,
      );
  }
  return { owned: !!r.rows.length };
}
export async function schedulerEnd(
  token: string,
  owner: string,
  handoff: boolean,
) {
  const b = await backend();
  await b.db.query(
    `update hemline_scheduler set owner=null,lease_until=now()+($3::integer * interval '1 second') where id=1 and token=$1 and owner=$2`,
    [token, owner, handoff ? 240 : -1],
  );
  return { ok: true };
}
export async function schedulerCheck(token: string, owner: string) {
  const b = await backend();
  const r = await b.db.query(
    "select token from hemline_scheduler where id=1 and token=$1 and owner=$2 and lease_until>now()",
    [token, owner],
  );
  if (!r.rows.length)
    throw new DomainError(
      "SCHEDULER_STALE",
      "Scheduler lease expired or superseded",
      409,
    );
}
let lastWake = 0;
export async function wakeScheduler() {
  const url = process.env.LAMBDA_WORKER_URL;
  if (!url || Date.now() - lastWake < 15000) return;
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !/^[a-z0-9-]+\.lambda-url\.us-east-1\.on\.aws$/.test(parsed.hostname)
  )
    throw new Error("Worker URL must be Lambda in us-east-1");
  lastWake = Date.now();
  const r = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.WORKER_SECRET}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    lastWake = 0;
    throw new Error(`Scheduler wake failed (${r.status})`);
  }
}
