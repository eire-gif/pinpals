-- Per-user notifications (a new offer, an accepted offer, an outbid alert,
-- a shipped order, etc.). System-populated only — no application code
-- writes here yet in this schema-only phase; this is the table a later
-- phase's triggers/functions and UI will read from and mark as read.
--
-- Rollback: `drop table if exists public.notifications cascade;`

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null check (char_length(title) <= 200),
  body text check (char_length(body) <= 2000),
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_idx on public.notifications (user_id);
create index if not exists notifications_user_id_read_at_idx
  on public.notifications (user_id, read_at) where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "users can view their own notifications" on public.notifications;
create policy "users can view their own notifications"
  on public.notifications for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Users may only mark their own notifications read, not edit their content:
-- with check re-asserts user_id/type/title/body/data are unchanged.
drop policy if exists "users can mark their own notifications read" on public.notifications;
create policy "users can mark their own notifications read"
  on public.notifications for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- System-populated only: no insert/delete for anon or authenticated.
revoke insert, delete, truncate, references, trigger
  on public.notifications from anon;
revoke insert, delete, truncate, references, trigger
  on public.notifications from authenticated;
