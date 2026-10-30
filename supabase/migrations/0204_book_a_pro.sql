-- 0204 — Book a pro (30 Oct 2026, claude/book-a-pro.md)
--
-- Asked by Eire, 30 Oct 2026 (canvas "PinPals Book a Pro", "build it"):
-- golf pros list lessons, playing lessons and club fittings; members book a
-- time and pay in the app; PinPals keeps 10% of the price and pays the pro
-- the rest.
--
--   - Pros apply (pros): PGA professionals with their PGA number, and
--     qualified teaching pros and club fitters who aren't PGA members with
--     their qualification. Each sets a short bio and their own cancellation
--     terms (24 hours, 48 hours, or no refunds). They are listed only once
--     PinPals approves them (admin → Marketplace → Pros, service role).
--   - What they offer (pro_services), their weekly hours (pro_hours) and
--     time off (pro_time_off). Free times come from pro_slots(), which never
--     shows who has the other slots.
--   - A booking (pro_bookings) holds its time for 15 minutes while the member
--     pays. Payment is a Stripe PaymentIntent made by the website
--     (src/lib/lessons-server.ts); the webhook confirms it through
--     pro_booking_paid(). The money is held on PinPals until the lesson's
--     end, then 90% is transferred to the pro's Stripe account.
--   - Cancelling: pro_booking_cancel() decides the refund — the whole price
--     when the pro cancels, or when the member cancels inside the pro's free
--     cancellation window; nothing otherwise, and then the pro is still paid.
--     The website makes the refund.
--
-- Tables have identity keys (the 0199 lesson). Members only read; writes go
-- through the functions below or the service role. The money functions
-- (pro_booking_paid, pro_bookings_expire, pro_bookings_due) are service role
-- only.
--
-- Rollback:
--   drop function if exists public.pro_apply(jsonb), public.pro_set_paused(boolean),
--     public.pro_service_save(bigint, jsonb), public.pro_service_remove(bigint),
--     public.pro_hours_set(jsonb), public.pro_time_off_add(timestamptz, timestamptz),
--     public.pro_time_off_remove(bigint), public.pro_slots(bigint, date, integer),
--     public.pro_book(bigint, timestamptz, text[], text), public.pro_booking_cancel(bigint, text),
--     public.pro_booking_paid(bigint, text, integer), public.pro_bookings_expire(),
--     public.pro_bookings_due();
--   drop table if exists public.pro_bookings, public.pro_time_off, public.pro_hours, public.pro_services, public.pros;

create table if not exists public.pros (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('pga', 'teaching', 'fitter')),
  pga_number text check (pga_number is null or char_length(pga_number) between 2 and 30),
  qualification text check (qualification is null or char_length(qualification) between 2 and 120),
  club text not null check (char_length(club) between 2 and 80),
  county text check (county is null or char_length(county) between 2 and 40),
  bio text check (bio is null or char_length(bio) <= 500),
  cancel_policy text not null default '24h' check (cancel_policy in ('24h', '48h', 'none')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'paused')),
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 500),
  commission_rate numeric(4, 3) not null default 0.100 check (commission_rate >= 0 and commission_rate <= 0.5),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pros_member_key unique (member_id),
  check (kind <> 'pga' or pga_number is not null),
  check (kind = 'pga' or qualification is not null)
);
create index if not exists pros_status_idx on public.pros (status, county);
create index if not exists pros_reviewed_by_idx on public.pros (reviewed_by);

create table if not exists public.pro_services (
  id bigint generated always as identity primary key,
  pro_id bigint not null references public.pros (id) on delete cascade,
  kind text not null check (kind in ('lesson', 'playing', 'fitting')),
  title text not null check (char_length(title) between 2 and 60),
  details text check (details is null or char_length(details) <= 120),
  minutes integer not null check (minutes between 15 and 300 and minutes % 15 = 0),
  price_cents integer not null check (price_cents between 500 and 200000),
  active boolean not null default true,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists pro_services_pro_idx on public.pro_services (pro_id, position);

create table if not exists public.pro_hours (
  id bigint generated always as identity primary key,
  pro_id bigint not null references public.pros (id) on delete cascade,
  -- 0 = Monday … 6 = Sunday, in Irish time.
  weekday smallint not null check (weekday between 0 and 6),
  start_min smallint not null check (start_min between 0 and 1425),
  end_min smallint not null check (end_min between 15 and 1440),
  check (end_min > start_min)
);
create index if not exists pro_hours_pro_idx on public.pro_hours (pro_id, weekday);

create table if not exists public.pro_time_off (
  id bigint generated always as identity primary key,
  pro_id bigint not null references public.pros (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at > starts_at)
);
create index if not exists pro_time_off_pro_idx on public.pro_time_off (pro_id, ends_at);

create table if not exists public.pro_bookings (
  id bigint generated always as identity primary key,
  pro_id bigint not null references public.pros (id) on delete restrict,
  service_id bigint references public.pro_services (id) on delete set null,
  member_id uuid not null references public.profiles (id) on delete restrict,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price_cents integer not null check (price_cents > 0),
  commission_cents integer not null check (commission_cents >= 0),
  cancel_policy text not null check (cancel_policy in ('24h', '48h', 'none')),
  -- Null: no free cancellation (the pro's "no refunds").
  free_cancel_until timestamptz,
  focus text[] not null default '{}',
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'booked', 'cancelled', 'expired')),
  hold_until timestamptz not null default (now() + interval '15 minutes'),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'pending', 'paid')),
  payment_reference text,
  paid_at timestamptz,
  payout_status text not null default 'none' check (payout_status in ('none', 'held', 'released', 'failed')),
  payout_reference text,
  released_at timestamptz,
  cancelled_by text check (cancelled_by is null or cancelled_by in ('member', 'pro', 'system')),
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  refund_cents integer not null default 0 check (refund_cents >= 0),
  refund_status text check (refund_status is null or refund_status in ('pending', 'succeeded', 'failed')),
  refund_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists pro_bookings_pro_idx on public.pro_bookings (pro_id, starts_at);
create index if not exists pro_bookings_member_idx on public.pro_bookings (member_id, starts_at desc);
create index if not exists pro_bookings_service_idx on public.pro_bookings (service_id);
create index if not exists pro_bookings_payment_idx on public.pro_bookings (payment_reference) where payment_reference is not null;
create index if not exists pro_bookings_release_idx on public.pro_bookings (ends_at) where payout_status = 'held';

comment on table public.pros is 'Book a pro (0204): a golf pro or club fitter who teaches on PinPals. Listed once status = approved (by PinPals staff). Written through pro_apply() and the service role.';
comment on table public.pro_bookings is 'Book a pro (0204): one lesson, playing lesson or fitting. Paid through Stripe and held on PinPals until it ends; the pro then gets price_cents - commission_cents.';

alter table public.pros enable row level security;
alter table public.pro_services enable row level security;
alter table public.pro_hours enable row level security;
alter table public.pro_time_off enable row level security;
alter table public.pro_bookings enable row level security;
revoke all on public.pros, public.pro_services, public.pro_hours, public.pro_time_off, public.pro_bookings from anon;
revoke insert, update, delete, truncate, references, trigger on public.pros, public.pro_services, public.pro_hours, public.pro_time_off, public.pro_bookings from authenticated;
grant select on public.pros, public.pro_services, public.pro_hours, public.pro_time_off, public.pro_bookings to authenticated;

create policy "Approved pros, and your own" on public.pros
  for select to authenticated using (
    member_id = (select auth.uid())
    or (status = 'approved' and not public.is_blocked((select auth.uid()), member_id))
    or public.is_staff()
  );
create policy "What approved pros offer, and your own" on public.pro_services
  for select to authenticated using (
    exists (
      select 1 from public.pros p
       where p.id = pro_id
         and (p.member_id = (select auth.uid()) or p.status = 'approved' or public.is_staff())
    )
  );
create policy "A pro's own hours" on public.pro_hours
  for select to authenticated using (
    exists (select 1 from public.pros p where p.id = pro_id and (p.member_id = (select auth.uid()) or public.is_staff()))
  );
create policy "A pro's own time off" on public.pro_time_off
  for select to authenticated using (
    exists (select 1 from public.pros p where p.id = pro_id and (p.member_id = (select auth.uid()) or public.is_staff()))
  );
create policy "Your lessons, as the golfer or the pro" on public.pro_bookings
  for select to authenticated using (
    member_id = (select auth.uid())
    or exists (select 1 from public.pros p where p.id = pro_id and p.member_id = (select auth.uid()))
    or public.is_staff()
  );

-- ---------------------------------------------------------------------------
-- The pro's side
-- ---------------------------------------------------------------------------

-- p: { kind, pga_number?, qualification?, club, county?, bio?, cancel_policy }
create or replace function public.pro_apply(p jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_kind text := nullif(p ->> 'kind', '');
  v_pga text := nullif(btrim(coalesce(p ->> 'pga_number', '')), '');
  v_qual text := nullif(btrim(coalesce(p ->> 'qualification', '')), '');
  v_club text := btrim(coalesce(p ->> 'club', ''));
  v_county text := nullif(btrim(coalesce(p ->> 'county', '')), '');
  v_bio text := nullif(btrim(coalesce(p ->> 'bio', '')), '');
  v_policy text := coalesce(nullif(p ->> 'cancel_policy', ''), '24h');
  old public.pros%rowtype;
  v_id bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me and deleted_at is null) then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_minor(me) then
    raise exception 'You need to be 18 or over to teach on PinPals.' using errcode = '42501';
  end if;
  if v_kind is null or v_kind not in ('pga', 'teaching', 'fitter') then
    raise exception 'Are you a PGA pro, a teaching pro or a club fitter?';
  end if;
  if v_kind = 'pga' and (v_pga is null or char_length(v_pga) not between 2 and 30) then
    raise exception 'Put in your PGA membership number.';
  end if;
  if v_kind <> 'pga' and (v_qual is null or char_length(v_qual) not between 2 and 120) then
    raise exception 'Say what qualification you hold, and from whom.';
  end if;
  if char_length(v_club) not between 2 and 80 then raise exception 'Where do you teach? (80 letters at most)'; end if;
  if v_county is not null and char_length(v_county) not between 2 and 40 then raise exception 'Pick a county.'; end if;
  if v_bio is not null and char_length(v_bio) > 500 then raise exception 'Keep your bio to 500 letters.'; end if;
  if v_policy not in ('24h', '48h', 'none') then raise exception 'Pick your cancellation terms.'; end if;
  if v_kind <> 'pga' then v_pga := null; else v_qual := null; end if;

  select * into old from public.pros where member_id = me;
  if not found then
    insert into public.pros (member_id, kind, pga_number, qualification, club, county, bio, cancel_policy)
    values (me, v_kind, v_pga, v_qual, v_club, v_county, v_bio, v_policy)
    returning id into v_id;
    return v_id;
  end if;

  update public.pros
     set kind = v_kind, pga_number = v_pga, qualification = v_qual, club = v_club, county = v_county,
         bio = v_bio, cancel_policy = v_policy, updated_at = now(),
         -- New credentials, or a declined application sent again, go back
         -- to PinPals to check.
         status = case
           when old.status = 'declined' then 'pending'
           when old.kind is distinct from v_kind or old.pga_number is distinct from v_pga
                or old.qualification is distinct from v_qual then 'pending'
           else old.status end,
         decline_reason = case when old.status = 'declined' then null else old.decline_reason end
   where id = old.id;
  return old.id;
end;
$$;
revoke all on function public.pro_apply(jsonb) from public, anon, authenticated;
grant execute on function public.pro_apply(jsonb) to authenticated;

create or replace function public.pro_set_paused(p_paused boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  update public.pros
     set status = case when p_paused then 'paused' else 'approved' end, updated_at = now()
   where member_id = me and status in ('approved', 'paused');
  if not found then
    raise exception 'Only an approved pro can pause or restart their bookings.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.pro_set_paused(boolean) from public, anon, authenticated;
grant execute on function public.pro_set_paused(boolean) to authenticated;

-- p: { kind, title, details?, minutes, price_cents, position? }
create or replace function public.pro_service_save(p_id bigint, p jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_pro bigint;
  v_kind text := nullif(p ->> 'kind', '');
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_details text := nullif(btrim(coalesce(p ->> 'details', '')), '');
  v_minutes integer := nullif(p ->> 'minutes', '')::integer;
  v_price integer := nullif(p ->> 'price_cents', '')::integer;
  v_pos smallint := coalesce(nullif(p ->> 'position', '')::smallint, 0);
  v_id bigint;
begin
  select id into v_pro from public.pros where member_id = me;
  if v_pro is null then raise exception 'Apply to teach on PinPals first.' using errcode = '42501'; end if;
  if v_kind is null or v_kind not in ('lesson', 'playing', 'fitting') then raise exception 'Is it a lesson, a playing lesson or a fitting?'; end if;
  if char_length(v_title) not between 2 and 60 then raise exception 'Give it a name (60 letters at most).'; end if;
  if v_details is not null and char_length(v_details) > 120 then raise exception 'Keep the details to 120 letters.'; end if;
  if v_minutes is null or v_minutes not between 15 and 300 or v_minutes % 15 <> 0 then
    raise exception 'How long is it? In 15-minute steps, up to 5 hours.';
  end if;
  if v_price is null or v_price not between 500 and 200000 then raise exception 'Set a price between €5 and €2,000.'; end if;

  if p_id is null then
    if (select count(*) from public.pro_services where pro_id = v_pro and active) >= 12 then
      raise exception 'You can offer up to 12 at a time. Take one off first.';
    end if;
    insert into public.pro_services (pro_id, kind, title, details, minutes, price_cents, position)
    values (v_pro, v_kind, v_title, v_details, v_minutes, v_price, v_pos)
    returning id into v_id;
  else
    update public.pro_services
       set kind = v_kind, title = v_title, details = v_details, minutes = v_minutes, price_cents = v_price, position = v_pos
     where id = p_id and pro_id = v_pro and active
    returning id into v_id;
    if v_id is null then raise exception 'That isn''t one of yours.' using errcode = '42501'; end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.pro_service_save(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.pro_service_save(bigint, jsonb) to authenticated;

-- Takes it off the menu. Bookings already made keep their title and price.
create or replace function public.pro_service_remove(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pro_services s set active = false
   where s.id = p_id and exists (select 1 from public.pros p where p.id = s.pro_id and p.member_id = (select auth.uid()));
  if not found then raise exception 'That isn''t one of yours.' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.pro_service_remove(bigint) from public, anon, authenticated;
grant execute on function public.pro_service_remove(bigint) to authenticated;

-- p: [{ weekday, start_min, end_min }, …] — replaces the whole week.
create or replace function public.pro_hours_set(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pro bigint;
  r jsonb;
  v_day integer;
  v_start integer;
  v_end integer;
begin
  select id into v_pro from public.pros where member_id = (select auth.uid());
  if v_pro is null then raise exception 'Apply to teach on PinPals first.' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 28 then
    raise exception 'Set up to four times a day.';
  end if;
  delete from public.pro_hours where pro_id = v_pro;
  for r in select * from jsonb_array_elements(p) loop
    v_day := (r ->> 'weekday')::integer;
    v_start := (r ->> 'start_min')::integer;
    v_end := (r ->> 'end_min')::integer;
    if v_day is null or v_day not between 0 and 6 or v_start is null or v_end is null
       or v_start < 0 or v_end > 1440 or v_end <= v_start or v_start % 15 <> 0 or v_end % 15 <> 0 then
      raise exception 'Those hours don''t look right.';
    end if;
    insert into public.pro_hours (pro_id, weekday, start_min, end_min) values (v_pro, v_day, v_start, v_end);
  end loop;
end;
$$;
revoke all on function public.pro_hours_set(jsonb) from public, anon, authenticated;
grant execute on function public.pro_hours_set(jsonb) to authenticated;

create or replace function public.pro_time_off_add(p_starts timestamptz, p_ends timestamptz)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pro bigint;
  v_id bigint;
begin
  select id into v_pro from public.pros where member_id = (select auth.uid());
  if v_pro is null then raise exception 'Apply to teach on PinPals first.' using errcode = '42501'; end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts or p_ends <= now() or p_ends - p_starts > interval '62 days' then
    raise exception 'Pick a start and an end, up to two months apart.';
  end if;
  insert into public.pro_time_off (pro_id, starts_at, ends_at) values (v_pro, p_starts, p_ends) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.pro_time_off_add(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.pro_time_off_add(timestamptz, timestamptz) to authenticated;

create or replace function public.pro_time_off_remove(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.pro_time_off t
   where t.id = p_id and exists (select 1 from public.pros p where p.id = t.pro_id and p.member_id = (select auth.uid()));
end;
$$;
revoke all on function public.pro_time_off_remove(bigint) from public, anon, authenticated;
grant execute on function public.pro_time_off_remove(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- The golfer's side
-- ---------------------------------------------------------------------------

-- Free start times for one of a pro's services, from p_from for p_days days
-- (up to 28), every 30 minutes inside the pro's hours, at least 2 hours
-- ahead. Never says who has the other times.
create or replace function public.pro_slots(p_service_id bigint, p_from date, p_days integer default 14)
returns table (starts_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select sv.pro_id, sv.minutes
      from public.pro_services sv
      join public.pros p on p.id = sv.pro_id
     where sv.id = p_service_id
       and sv.active
       and (p.status = 'approved' or p.member_id = (select auth.uid()))
  ),
  first_day as (
    select greatest(coalesce(p_from, current_date), (now() at time zone 'Europe/Dublin')::date) as d
  ),
  days as (
    select (fd.d + g)::date as day
      from first_day fd, generate_series(0, least(greatest(coalesce(p_days, 14), 1), 28) - 1) g
  ),
  cand as (
    select ((dy.day::timestamp + make_interval(mins => m)) at time zone 'Europe/Dublin') as st, s.minutes, s.pro_id
      from s
      cross join days dy
      join public.pro_hours h on h.pro_id = s.pro_id and h.weekday = extract(isodow from dy.day)::integer - 1
      cross join lateral generate_series(h.start_min::integer, h.end_min::integer - s.minutes, 30) m
  )
  select c.st
    from cand c
   where c.st >= now() + interval '2 hours'
     and not exists (
       select 1 from public.pro_time_off t
        where t.pro_id = c.pro_id
          and tstzrange(t.starts_at, t.ends_at) && tstzrange(c.st, c.st + make_interval(mins => c.minutes))
     )
     and not exists (
       select 1 from public.pro_bookings b
        where b.pro_id = c.pro_id
          and (b.status = 'booked' or (b.status = 'pending_payment' and b.hold_until > now()))
          and tstzrange(b.starts_at, b.ends_at) && tstzrange(c.st, c.st + make_interval(mins => c.minutes))
     )
   group by c.st
   order by c.st;
$$;
revoke all on function public.pro_slots(bigint, date, integer) from public, anon, authenticated;
grant execute on function public.pro_slots(bigint, date, integer) to authenticated;

-- Holds the time for 15 minutes; the member then pays on the website.
create or replace function public.pro_book(p_service_id bigint, p_starts_at timestamptz, p_focus text[], p_note text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  sv public.pro_services%rowtype;
  pr public.pros%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_focus text[] := coalesce(p_focus, '{}');
  v_id bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me and deleted_at is null) then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into sv from public.pro_services where id = p_service_id and active;
  if not found then raise exception 'That isn''t offered any more.'; end if;
  select * into pr from public.pros where id = sv.pro_id;
  if pr.status <> 'approved' then raise exception 'This pro isn''t taking bookings right now.'; end if;
  if pr.member_id = me then raise exception 'You can''t book yourself.'; end if;
  if public.is_blocked(me, pr.member_id) then raise exception 'You can''t book this pro.' using errcode = '42501'; end if;
  if public.is_minor(me) then
    raise exception 'Lessons for members under 18 are booked by a parent for now.' using errcode = '42501';
  end if;
  if array_length(v_focus, 1) > 6
     or exists (select 1 from unnest(v_focus) f where f not in ('Driver', 'Woods', 'Irons', 'Short game', 'Bunkers', 'Putting', 'Course strategy', 'Fitting')) then
    raise exception 'Pick what to work on from the list.';
  end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'Keep the note to 300 letters.'; end if;
  if (select count(*) from public.pro_bookings where member_id = me and status = 'pending_payment' and hold_until > now()) >= 3 then
    raise exception 'Finish paying for the times you''re holding first.';
  end if;

  -- One booking at a time per pro, so two members can't take the same slot.
  perform pg_advisory_xact_lock(hashtextextended('pro_booking:' || pr.id, 0));
  if not exists (
    select 1 from public.pro_slots(p_service_id, (p_starts_at at time zone 'Europe/Dublin')::date, 1) s
     where s.starts_at = p_starts_at
  ) then
    raise exception 'That time has just gone. Pick another.';
  end if;

  insert into public.pro_bookings (pro_id, service_id, member_id, title, starts_at, ends_at, price_cents, commission_cents,
                                   cancel_policy, free_cancel_until, focus, note)
  values (pr.id, sv.id, me, sv.title, p_starts_at, p_starts_at + make_interval(mins => sv.minutes), sv.price_cents,
          round(sv.price_cents * pr.commission_rate)::integer, pr.cancel_policy,
          case pr.cancel_policy when '24h' then p_starts_at - interval '24 hours'
                                when '48h' then p_starts_at - interval '48 hours' end,
          v_focus, v_note)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.pro_book(bigint, timestamptz, text[], text) from public, anon, authenticated;
grant execute on function public.pro_book(bigint, timestamptz, text[], text) to authenticated;

-- Either side cancels. Decides the refund; the website makes it.
create or replace function public.pro_booking_cancel(p_booking_id bigint, p_reason text)
returns table (refund_cents integer, payment_reference text, other_party uuid, by_pro boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  b public.pro_bookings%rowtype;
  v_pro_member uuid;
  v_by_pro boolean;
  v_refund integer;
begin
  select * into b from public.pro_bookings where id = p_booking_id for update;
  if not found then raise exception 'That booking isn''t there any more.' using errcode = 'P0002'; end if;
  select member_id into v_pro_member from public.pros where id = b.pro_id;
  if me is null or (me is distinct from b.member_id and me is distinct from v_pro_member) then
    raise exception 'Only the golfer or the pro can cancel this.' using errcode = '42501';
  end if;
  if b.status = 'pending_payment' then
    update public.pro_bookings set status = 'expired', updated_at = now() where id = b.id;
    return query select 0, null::text, null::uuid, false;
    return;
  end if;
  if b.status <> 'booked' then raise exception 'This has already been cancelled.'; end if;
  if b.starts_at <= now() then raise exception 'This has started, so it can''t be cancelled now.'; end if;

  v_by_pro := me = v_pro_member and me is distinct from b.member_id;
  v_refund := case
    when b.payment_status <> 'paid' then 0
    when v_by_pro then b.price_cents
    when b.free_cancel_until is not null and now() <= b.free_cancel_until then b.price_cents
    else 0 end;

  update public.pro_bookings
     set status = 'cancelled',
         cancelled_by = case when v_by_pro then 'pro' else 'member' end,
         cancelled_at = now(),
         cancel_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 300),
         refund_cents = v_refund,
         refund_status = case when v_refund > 0 then 'pending' end,
         -- A late cancel by the golfer: the pro is still paid at the lesson's time.
         payout_status = case when v_refund > 0 then 'none' else payout_status end,
         updated_at = now()
   where id = b.id;
  return query select v_refund, b.payment_reference,
    case when v_by_pro then b.member_id else v_pro_member end, v_by_pro;
end;
$$;
revoke all on function public.pro_booking_cancel(bigint, text) from public, anon, authenticated;
grant execute on function public.pro_booking_cancel(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Money (service role only: src/lib/lessons-server.ts)
-- ---------------------------------------------------------------------------

-- The webhook says it's paid. 'booked' (or 'already'); 'clash' when the hold
-- lapsed and someone else took the time — the caller refunds in full;
-- 'mismatch' when the amount isn't the price; 'missing'.
create or replace function public.pro_booking_paid(p_booking_id bigint, p_payment_intent text, p_amount_cents integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.pro_bookings%rowtype;
begin
  select * into b from public.pro_bookings where id = p_booking_id for update;
  if not found then return 'missing'; end if;
  if b.payment_status = 'paid' then return 'already'; end if;
  if p_amount_cents is distinct from b.price_cents then return 'mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pro_booking:' || b.pro_id, 0));

  if b.status in ('pending_payment', 'expired') and not exists (
    select 1 from public.pro_bookings o
     where o.pro_id = b.pro_id and o.id <> b.id
       and (o.status = 'booked' or (o.status = 'pending_payment' and o.hold_until > now()))
       and tstzrange(o.starts_at, o.ends_at) && tstzrange(b.starts_at, b.ends_at)
  ) and not exists (
    select 1 from public.pro_time_off t
     where t.pro_id = b.pro_id and tstzrange(t.starts_at, t.ends_at) && tstzrange(b.starts_at, b.ends_at)
  ) then
    update public.pro_bookings
       set status = 'booked', payment_status = 'paid', payment_reference = p_payment_intent, paid_at = now(),
           payout_status = 'held', updated_at = now()
     where id = b.id;
    return 'booked';
  end if;

  update public.pro_bookings
     set status = 'cancelled', cancelled_by = 'system', cancelled_at = coalesce(cancelled_at, now()),
         payment_status = 'paid', payment_reference = p_payment_intent, paid_at = now(),
         refund_cents = b.price_cents, refund_status = 'pending', payout_status = 'none', updated_at = now()
   where id = b.id;
  return 'clash';
end;
$$;
revoke all on function public.pro_booking_paid(bigint, text, integer) from public, anon, authenticated;

-- Holds nobody paid for go back on the sheet.
create or replace function public.pro_bookings_expire()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.pro_bookings
     set status = 'expired', updated_at = now()
   where status = 'pending_payment' and hold_until <= now() and payment_status <> 'pending';
  get diagnostics n = row_count;
  -- A payment started but never finished: give it an hour.
  update public.pro_bookings
     set status = 'expired', updated_at = now()
   where status = 'pending_payment' and hold_until <= now() - interval '1 hour';
  return n;
end;
$$;
revoke all on function public.pro_bookings_expire() from public, anon, authenticated;

-- Lessons whose money is due to the pro: over, or cancelled late by the golfer.
create or replace function public.pro_bookings_due()
returns table (id bigint, pro_member uuid, title text, starts_at timestamptz, payout_cents integer, payment_reference text)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, p.member_id, b.title, b.starts_at, b.price_cents - b.commission_cents, b.payment_reference
    from public.pro_bookings b
    join public.pros p on p.id = b.pro_id
   where b.payout_status = 'held'
     and b.payment_status = 'paid'
     and b.payment_reference is not null
     and (
       (b.status = 'booked' and b.ends_at <= now())
       or (b.status = 'cancelled' and b.cancelled_by = 'member' and b.refund_cents = 0 and b.ends_at <= now())
     )
   order by b.ends_at
   limit 100;
$$;
revoke all on function public.pro_bookings_due() from public, anon, authenticated;
