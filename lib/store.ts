import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "pg";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { seed, DomainError, type Ward } from "./domain";
import { isLocalDemo } from "./security";
interface DB {
  query<T extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}
interface Backend {
  transaction<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  db: DB;
}
function hydrate(w: Ward) {
  for (const t of w.transfers) {
    if (t.offer) {
      const i = t.offers.findIndex((o) => o.id === t.offer!.id);
      if (i >= 0) t.offers[i] = t.offer;
      else t.offers.push(t.offer);
    }
  }
  return w;
}
const globalDb = globalThis as unknown as { hemlineDb?: Promise<Backend> };
export function backend() {
  return (globalDb.hemlineDb ??= open());
}
async function open(): Promise<Backend> {
  const sql = await readFile(
    `${process.cwd()}/supabase/migrations/001_hemline.sql`,
    "utf8",
  );
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
    await pool.query(sql);
    return {
      db: pool,
      transaction: async (fn) => {
        const client: PoolClient = await pool.connect();
        try {
          await client.query("begin");
          const result = await fn(client);
          await client.query("commit");
          return result;
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally {
          client.release();
        }
      },
    };
  }
  if (process.env.NODE_ENV === "production")
    throw new DomainError("CONFIG", "DATABASE_URL required in production", 503);
  await mkdir(".data", { recursive: true });
  const pg = new PGlite(
    process.env.NODE_ENV === "test" ? undefined : ".data/postgres",
  );
  await pg.exec(sql);
  return { db: pg, transaction: (fn) => pg.transaction((tx) => fn(tx)) };
}
async function syncJobs(db: DB, w: Ward) {
  for (const run of w.runs.filter((r) => r.status === "pending"))
    await db.query(
      "insert into hemline_jobs(id,sandbox_id,run_id) values($1,$2,$3) on conflict(run_id) do nothing",
      [randomUUID(), w.id, run.id],
    );
}
export async function createSandbox(owner: string) {
  const b = await backend();
  return b.transaction(async (db) => {
    const existing = await db.query<{ state: Ward }>(
      "select state from hemline_sandboxes where owner=$1 and (state->>'expiresAt')::bigint>$2 limit 1",
      [owner, Date.now()],
    );
    if (existing.rows[0]) return existing.rows[0].state;
    const w = seed();
    await db.query(
      "insert into hemline_sandboxes(id,owner,state) values($1,$2,$3)",
      [w.id, owner, JSON.stringify(w)],
    );
    return w;
  });
}
export async function mutate<T>(
  id: string,
  owner: string | null,
  fn: (w: Ward) => T | Promise<T>,
  fence?: string,
) {
  const b = await backend();
  return b.transaction(async (db) => {
    if (fence) {
      const lease = await db.query(
        "select id from hemline_jobs where token=$1 and status='running' and lease_until>now() for update",
        [fence],
      );
      if (!lease.rows.length)
        throw new DomainError("LEASE_LOST", "Worker lease lost");
    }
    const result = await db.query<{ state: Ward; owner: string }>(
      "select state,owner from hemline_sandboxes where id=$1 for update",
      [id],
    );
    const row = result.rows[0];
    if (!row || (owner !== null && row.owner !== owner))
      throw new DomainError("NOT_FOUND", "Sandbox not found", 404);
    if (row.state.expiresAt < Date.now())
      throw new DomainError("EXPIRED", "Sandbox expired", 410);
    const w = hydrate(row.state);
    const value = await fn(w);
    await db.query(
      "update hemline_sandboxes set state=$2,updated_at=now() where id=$1",
      [id, JSON.stringify(w)],
    );
    await syncJobs(db, w);
    return value;
  });
}
export async function readWard(id: string, owner: string) {
  const b = await backend();
  const result = await b.db.query<{ state: Ward }>(
    "select state from hemline_sandboxes where id=$1 and owner=$2",
    [id, owner],
  );
  const w = result.rows[0]?.state;
  if (!w) throw new DomainError("NOT_FOUND", "Sandbox not found", 404);
  if (w.expiresAt < Date.now())
    throw new DomainError("EXPIRED", "Sandbox expired", 410);
  return hydrate(w);
}
export async function claim(sandboxId: string | null = null) {
  const b = await backend();
  return b.transaction(async (db) => {
    const picked = await db.query<{
      id: string;
      sandbox_id: string;
      run_id: string;
    }>(
      `select j.id,j.sandbox_id,j.run_id from hemline_jobs j join hemline_sandboxes s on s.id=j.sandbox_id where (j.status='pending' or (j.status='running' and j.lease_until<now())) and (s.state->>'expiresAt')::bigint>$1 and ($2::uuid is null or j.sandbox_id=$2) and not exists(select 1 from hemline_jobs other where other.sandbox_id=j.sandbox_id and other.status='running' and other.lease_until>now()) order by j.attempts,j.id for update of j skip locked limit 1`,
      [Date.now(), sandboxId],
    );
    const job = picked.rows[0];
    if (!job) return null;
    const token = randomUUID();
    await db.query(
      `update hemline_jobs set status='running',token=$2,lease_until=now()+interval '120 seconds',attempts=attempts+1 where id=$1`,
      [job.id, token],
    );
    return { ...job, token };
  });
}
export async function finish(token: string, status = "done") {
  const b = await backend();
  await b.db.query(
    "update hemline_jobs set status=$2,lease_until=null where token=$1",
    [token, status],
  );
}
export async function allIds() {
  const b = await backend();
  return (
    await b.db.query<{ id: string }>(
      "select id from hemline_sandboxes where (state->>'expiresAt')::bigint>$1",
      [Date.now()],
    )
  ).rows.map((r) => r.id);
}
export async function heartbeat() {
  const b = await backend();
  await b.db.query(
    "insert into hemline_heartbeat(id,at) values(1,now()) on conflict(id) do update set at=now()",
  );
}
export async function health() {
  const b = await backend();
  const result = await b.db.query<{ at: string }>(
    "select at from hemline_heartbeat where id=1",
  );
  return {
    database: true,
    worker: result.rows[0]
      ? Date.now() - new Date(result.rows[0].at).getTime() < 30000
      : false,
    storage: process.env.DATABASE_URL
      ? "hosted PostgreSQL"
      : "local embedded PostgreSQL",
  };
}
export async function reserve(id: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0)
    throw new DomainError("BUDGET", "Invalid cost reservation", 400);
  const local = isLocalDemo();
  const sandboxLimit = Number(
    local
      ? process.env.LOCAL_SANDBOX_MODEL_BUDGET_USD || 1
      : process.env.SANDBOX_MODEL_BUDGET_USD || 0.25,
  );
  const limits = [
    Number(process.env.GLOBAL_MODEL_BUDGET_USD || 10),
    Number(process.env.PUBLIC_MODEL_BUDGET_USD || 5),
    sandboxLimit,
  ];
  if (limits.some((limit) => !Number.isFinite(limit) || limit < 0))
    throw new DomainError("BUDGET_CONFIG", "Invalid budget configuration", 503);
  const b = await backend();
  return b.transaction(async (db) => {
    const global = await db.query<{ used: string; public_used: string }>(
      "select used,public_used from hemline_budget where id=1 for update",
    );
    const sandbox = await db.query<{ state: Ward }>(
      "select state from hemline_sandboxes where id=$1 for update",
      [id],
    );
    const w = sandbox.rows[0]?.state;
    if (!w) throw new DomainError("NOT_FOUND", "Sandbox missing", 404);
    if (Number(global.rows[0].used) + amount > limits[0])
      throw new DomainError("BUDGET", "Overall model budget exhausted", 429);
    if (!local && Number(global.rows[0].public_used) + amount > limits[1])
      throw new DomainError("BUDGET", "Public model budget exhausted", 429);
    if (w.cost + amount > sandboxLimit)
      throw new DomainError(
        "BUDGET",
        `Sandbox model budget exhausted ($${sandboxLimit.toFixed(2)} limit)`,
        429,
      );
    const key = randomUUID();
    w.cost += amount;
    await db.query(
      "update hemline_budget set used=used+$1,public_used=public_used+$2 where id=1",
      [amount, local ? 0 : amount],
    );
    await db.query("update hemline_sandboxes set state=$2 where id=$1", [
      id,
      JSON.stringify(w),
    ]);
    await db.query(
      "insert into hemline_reservations(id,sandbox_id,amount,public_charge) values($1,$2,$3,$4)",
      [key, id, amount, !local],
    );
    return key;
  });
}
export async function settle(key: string, actual: number) {
  const b = await backend();
  await b.transaction(async (db) => {
    await db.query("select id from hemline_budget where id=1 for update");
    const r = (
      await db.query<{
        sandbox_id: string;
        amount: string;
        status: string;
        public_charge: boolean;
      }>("select * from hemline_reservations where id=$1 for update", [key])
    ).rows[0];
    if (!r || r.status !== "reserved") return;
    const w = (
      await db.query<{ state: Ward }>(
        "select state from hemline_sandboxes where id=$1 for update",
        [r.sandbox_id],
      )
    ).rows[0].state;
    const delta = Number(r.amount) - actual;
    w.cost = Math.max(0, w.cost - delta);
    await db.query("update hemline_sandboxes set state=$2 where id=$1", [
      r.sandbox_id,
      JSON.stringify(w),
    ]);
    await db.query(
      "update hemline_budget set used=used-$1,public_used=public_used-$2 where id=1",
      [delta, r.public_charge ? delta : 0],
    );
    await db.query(
      "update hemline_reservations set status='settled',actual=$2 where id=$1",
      [key, actual],
    );
  });
}
export async function admission(ipHash: string) {
  const b = await backend();
  return b.transaction(async (db) => {
    await db.query(
      "insert into hemline_admission(ip_hash) values($1) on conflict do nothing",
      [ipHash],
    );
    const row = (
      await db.query<{ starts: number[] }>(
        "select starts from hemline_admission where ip_hash=$1 for update",
        [ipHash],
      )
    ).rows[0];
    const starts = row.starts.filter((at) => at > Date.now() - 3600000);
    if (starts.length >= 2)
      throw new DomainError("RATE_LIMIT", "Sandbox creation rate limit", 429);
    starts.push(Date.now());
    await db.query("update hemline_admission set starts=$2 where ip_hash=$1", [
      ipHash,
      JSON.stringify(starts),
    ]);
  });
}

export async function budgetDiagnostics() {
  const b = await backend();
  const global = await b.db.query(
    "select used, public_used from hemline_budget where id=1",
  );
  const sandboxes = await b.db.query(
    "select id, state->>'cost' as reserved_cost from hemline_sandboxes order by updated_at desc limit 5",
  );
  return { global: global.rows[0], sandboxes: sandboxes.rows };
}
