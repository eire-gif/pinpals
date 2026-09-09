-- Keep the denormalised club names in step with `clubs.name`.
--
-- 0061 kept `profiles.home_club` and `tee_time_invites.club_name` as display
-- copies of the club's name, because a dozen screens read them straight off a
-- `select("*")` with no join. That was the right call for the migration, but
-- it left an obvious hole: nothing was keeping the copies true.
--
-- The first OpenStreetMap import proved it immediately. A member whose home
-- club was seeded as "Grange Castle Golf Club" still read that way on their
-- profile after the import renamed the club to OSM's wording, "Grange Castle
-- Golf Course" — the id was right and the visible name was a version of
-- reality that no longer existed anywhere else on the site. Every future
-- import will rename some clubs, so this is a recurring drift, not a one-off.
--
-- A trigger rather than a job: the rename and the copies must not be able to
-- disagree even briefly, and there is nothing to schedule or remember.
-- Guarded on the name actually changing, so the ordinary import — which
-- rewrites every row's website and coordinates on each run — doesn't touch
-- `profiles` at all unless a name really moved.
--
-- The alternative was to drop the denormalised columns and join everywhere.
-- That remains the better end state and is what a later phase should do; this
-- makes the interim honest rather than entrenching it.

create or replace function public.sync_denormalised_club_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set home_club = new.name
  where home_club_id = new.id
    and home_club is distinct from new.name;

  update public.tee_time_invites
  set club_name = new.name
  where club_id = new.id
    and club_name is distinct from new.name;

  return new;
end;
$$;

drop trigger if exists clubs_sync_denormalised_names on public.clubs;
create trigger clubs_sync_denormalised_names
  after update of name on public.clubs
  for each row
  when (old.name is distinct from new.name)
  execute function public.sync_denormalised_club_names();

-- Backfill whatever has already drifted, including the rename above.
update public.profiles p
set home_club = c.name
from public.clubs c
where p.home_club_id = c.id
  and p.home_club is distinct from c.name;

update public.tee_time_invites t
set club_name = c.name
from public.clubs c
where t.club_id = c.id
  and t.club_name is distinct from c.name;
