-- Pinpals: make accepting and declining a tee-time place atomic
--
-- THE BUG THIS FIXES. respondToInterest() in
-- src/app/dashboard/availability/actions.ts currently does:
--
--   select spaces_available from tee_time_invites where id = ...
--   -- ... arithmetic in JavaScript ...
--   update tee_time_invites set spaces_available = <computed>, status = ...
--
-- Two hosts' clicks landing together — or one impatient double-click, which
-- is far more likely — both read `spaces_available = 1`, both compute 0, and
-- both write 0. Two golfers are told they have the last seat in a fourball.
-- Nothing in the schema stops it: the CHECK constraint only bounds the
-- column between 1 and 3 at insert time, and there is no lock anywhere in
-- the read-then-write.
--
-- confirmTeeTimePlace() has the mirror of the same problem when a golfer
-- drops out and the space is handed back.
--
-- Both moves are now single database functions that take a row lock on the
-- invite (`select ... for update`) before reading the count, so a second
-- caller waits rather than racing. The space arithmetic happens inside one
-- statement in Postgres, where `spaces_available - 1` is evaluated against
-- the row as locked.
--
-- They also enforce the rules the Server Actions were enforcing in
-- TypeScript — only the host may answer a request, only the requester may
-- confirm their own place, only a pending request can be answered, only an
-- open invite can have a space taken. Those checks now sit next to the lock
-- that makes them meaningful.
--
-- GRANTS. Note the `revoke ... from anon` below, by name. Supabase's
-- ALTER DEFAULT PRIVILEGES grants EXECUTE on every new function in `public`
-- to anon, authenticated and service_role explicitly, so `revoke from public`
-- would leave anon holding it — the mistake 0075 made and 0076 fixed. See
-- claude/incident-notify-user-grants-after-recreate.md. `authenticated` is
-- kept deliberately: both functions derive identity from auth.uid() and are
-- meant to be called by a signed-in member.
--
-- A SECOND, LARGER BUG, found while writing the above. `spaces_available`
-- is constrained `>= 1`, but the accept path writes `Math.max(0, n - 1)`.
-- So filling the LAST space raises a check violation every time — accepting
-- the final golfer has never worked. Worse, the Server Action updates the
-- interest's status BEFORE touching the count, so the failure leaves the two
-- disagreeing: the golfer is marked accepted, the space is never taken, and
-- a raw Postgres constraint message is returned to the host as their error.
--
-- Production carries the fingerprint. Invite 3 has three interests in
-- accepted/confirmed state and still reads `status = 'open'`,
-- `spaces_available = 1`. Invite 4 reads `status = 'full'` with
-- `spaces_available = 2`. No invite anywhere has `spaces_available = 0`,
-- because the constraint makes that unreachable.
--
-- Section 0 relaxes the constraint to `>= 0`. Zero is a real, meaningful
-- value for this column — it is what "full" means — and nothing else wanted
-- the old lower bound: the posting form offers 1/2/3 and validates against
-- SPACES_OPTIONS before insert, so a member still cannot post a tee time
-- with no spaces on it.
--
-- EXISTING BAD ROWS ARE LEFT ALONE, deliberately. The original space count
-- isn't stored anywhere, so the correct current value can't be derived from
-- what survived — only guessed. There are eight invites in total and the
-- site is pre-launch; they are better fixed by eye than by a migration
-- inventing numbers.
--
-- Rollback:
--   drop function if exists public.respond_to_tee_time_interest(bigint, boolean);
--   drop function if exists public.confirm_tee_time_place(bigint, boolean);
--   alter table public.tee_time_invites drop constraint tee_time_invites_spaces_available_check;
--   alter table public.tee_time_invites add constraint tee_time_invites_spaces_available_check
--     check (spaces_available >= 1 and spaces_available <= 3);
--   -- (that rollback fails if any row has since reached 0 — which is the point)
--   -- and restore the read-then-write in the Server Actions.

-- ===========================================================================
-- 0. Zero is a legal number of remaining spaces
-- ===========================================================================

alter table public.tee_time_invites
  drop constraint if exists tee_time_invites_spaces_available_check;

alter table public.tee_time_invites
  add constraint tee_time_invites_spaces_available_check
  check (spaces_available >= 0 and spaces_available <= 3);

-- ===========================================================================
-- 1. The host answers a request
-- ===========================================================================

create function public.respond_to_tee_time_interest(
  p_interest_id bigint,
  p_accept      boolean
)
returns table (
  interest_id       bigint,
  applicant_id      uuid,
  invite_id         bigint,
  club_name         text,
  play_date         date,
  new_status        text,
  spaces_remaining  smallint
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller   uuid := (select auth.uid());
  v_interest public.tee_time_interests%rowtype;
  v_invite   public.tee_time_invites%rowtype;
  v_status   text := case when p_accept then 'accepted' else 'declined' end;
  v_left     smallint;
begin
  if v_caller is null then
    raise exception 'You need to be signed in to respond to a request.';
  end if;

  select * into v_interest from public.tee_time_interests where id = p_interest_id;
  if not found then
    raise exception 'That request no longer exists.';
  end if;

  -- THE LOCK. Everything below reads the invite's counts, so it has to be
  -- taken before the read, not after. A concurrent call blocks here until
  -- this transaction commits, then sees the decremented value.
  select * into v_invite
  from public.tee_time_invites
  where id = v_interest.invite_id
  for update;

  if not found then
    raise exception 'That tee time no longer exists.';
  end if;
  if v_invite.member_id <> v_caller then
    raise exception 'Only the host can respond to a request for their tee time.';
  end if;
  if v_interest.status <> 'pending' then
    raise exception 'That request has already been answered.';
  end if;

  if p_accept then
    if v_invite.status <> 'open' then
      raise exception 'That tee time is no longer open.';
    end if;
    -- The check the old JavaScript never made. Math.max(0, 0 - 1) silently
    -- produced 0 and carried on offering a seat that did not exist.
    if v_invite.spaces_available < 1 then
      raise exception 'There are no spaces left on that tee time.';
    end if;

    update public.tee_time_invites
      set spaces_available = spaces_available - 1,
          status = case when spaces_available - 1 = 0 then 'full' else status end
      where id = v_invite.id
      returning spaces_available into v_left;
  else
    v_left := v_invite.spaces_available;
  end if;

  update public.tee_time_interests
    set status = v_status
    where id = p_interest_id;

  return query
    select p_interest_id,
           v_interest.member_id,
           v_invite.id,
           v_invite.club_name,
           v_invite.play_date,
           v_status,
           v_left;
end;
$function$;

revoke all on function public.respond_to_tee_time_interest(bigint, boolean) from public, anon;
grant execute on function public.respond_to_tee_time_interest(bigint, boolean) to authenticated, service_role;

-- ===========================================================================
-- 2. The golfer confirms or drops out
-- ===========================================================================

create function public.confirm_tee_time_place(
  p_interest_id bigint,
  p_attending   boolean
)
returns table (
  interest_id  bigint,
  host_id      uuid,
  invite_id    bigint,
  club_name    text,
  play_date    date,
  new_status   text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller   uuid := (select auth.uid());
  v_interest public.tee_time_interests%rowtype;
  v_invite   public.tee_time_invites%rowtype;
  v_status   text := case when p_attending then 'confirmed' else 'declined' end;
begin
  if v_caller is null then
    raise exception 'You need to be signed in to confirm a place.';
  end if;

  select * into v_interest from public.tee_time_interests where id = p_interest_id;
  if not found then
    raise exception 'That tee-time offer no longer exists.';
  end if;
  if v_interest.member_id <> v_caller then
    raise exception 'That tee-time offer belongs to another member.';
  end if;
  if v_interest.status <> 'accepted' then
    raise exception 'That tee-time offer is no longer awaiting confirmation.';
  end if;

  -- Locked even on the confirming path, where no count changes: it keeps the
  -- host's own accept from interleaving with this update, and it means the
  -- returning-the-space branch below needs no second, different code path.
  select * into v_invite
  from public.tee_time_invites
  where id = v_interest.invite_id
  for update;

  if not found then
    raise exception 'That tee time no longer exists.';
  end if;

  update public.tee_time_interests
    set status = v_status
    where id = p_interest_id;

  -- Dropping out hands the space back, and reopens an invite that had gone
  -- full. A cancelled or completed invite is left alone — a member pulling
  -- out of a round the host has already called off must not quietly reopen
  -- it. The old TypeScript had this right and it is kept verbatim in spirit.
  if not p_attending and v_invite.status not in ('cancelled', 'completed') then
    update public.tee_time_invites
      set spaces_available = least(spaces_available + 1, 3),
          status = 'open'
      where id = v_invite.id;
  end if;

  return query
    select p_interest_id,
           v_invite.member_id,
           v_invite.id,
           v_invite.club_name,
           v_invite.play_date,
           v_status;
end;
$function$;

revoke all on function public.confirm_tee_time_place(bigint, boolean) from public, anon;
grant execute on function public.confirm_tee_time_place(bigint, boolean) to authenticated, service_role;
