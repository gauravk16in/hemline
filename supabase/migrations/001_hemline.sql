create table if not exists hemline_sandboxes(id uuid primary key, owner text not null, state jsonb not null, updated_at timestamptz not null default now());
create table if not exists hemline_jobs(id uuid primary key, sandbox_id uuid not null references hemline_sandboxes(id) on delete cascade, run_id uuid not null unique, status text not null default 'pending', token uuid, lease_until timestamptz, attempts integer not null default 0);
create table if not exists hemline_budget(id integer primary key check(id=1), used numeric not null default 0, public_used numeric not null default 0);
insert into hemline_budget(id) values(1) on conflict do nothing;
create table if not exists hemline_reservations(id uuid primary key, sandbox_id uuid not null references hemline_sandboxes(id), amount numeric not null, status text not null default 'reserved', actual numeric, created_at timestamptz not null default now());
create table if not exists hemline_admission(ip_hash text primary key, starts jsonb not null default '[]');
create table if not exists hemline_heartbeat(id integer primary key check(id=1), at timestamptz not null);
alter table hemline_sandboxes enable row level security;
alter table hemline_jobs enable row level security;
alter table hemline_budget enable row level security;
alter table hemline_reservations enable row level security;
alter table hemline_admission enable row level security;
alter table hemline_heartbeat enable row level security;
-- No client policies: all access is server-side through validated ownership.
-- Sandbox aggregate is locked for each transaction. All embedded records/events/receipts
-- commit together. Jobs and budget reservations are separate durable SQL records.
