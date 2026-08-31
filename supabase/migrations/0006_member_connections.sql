-- Pinpals: member connection requests and accepted connections

create table if not exists public.connections (
  id bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connections_not_self check (requester_id <> recipient_id)
);

-- Only one relationship can exist for a pair, regardless of who initiated it.
create unique index if not exists connections_member_pair_idx
  on public.connections (least(requester_id, recipient_id), greatest(requester_id, recipient_id));
create index if not exists connections_requester_idx on public.connections (requester_id);
create index if not exists connections_recipient_idx on public.connections (recipient_id);

alter table public.connections enable row level security;

drop trigger if exists connections_set_updated_at on public.connections;
create trigger connections_set_updated_at
  before update on public.connections
  for each row execute function public.set_updated_at();

create policy "Members view their own connections"
  on public.connections for select to authenticated
  using (requester_id = auth.uid() or recipient_id = auth.uid());

create policy "Members send connection requests"
  on public.connections for insert to authenticated
  with check (requester_id = auth.uid() and recipient_id <> auth.uid() and status = 'pending');

create policy "Recipients answer connection requests"
  on public.connections for update to authenticated
  using (recipient_id = auth.uid() and status = 'pending')
  with check (recipient_id = auth.uid() and status in ('accepted', 'declined'));

create policy "Members remove declined connections"
  on public.connections for delete to authenticated
  using ((requester_id = auth.uid() or recipient_id = auth.uid()) and status = 'declined');

