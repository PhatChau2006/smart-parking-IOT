-- Run once in the SQL Editor of the group's Supabase project.
-- Accounts belong to Supabase Auth (auth.users). No extra profiles table is needed.
create table if not exists public.parking_events (
  id text primary key,
  kind text not null check (kind in ('occupancy', 'temperature', 'barrier-command')),
  received_at bigint not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists parking_events_kind_time_idx
  on public.parking_events (kind, received_at desc, id desc);
create index if not exists parking_events_time_idx
  on public.parking_events (received_at desc, id desc);
alter table public.parking_events enable row level security;
revoke all on public.parking_events from anon, authenticated;
grant select, insert on public.parking_events to service_role;
-- Dashboard talks only to Node-RED. The server holds the secret key.
