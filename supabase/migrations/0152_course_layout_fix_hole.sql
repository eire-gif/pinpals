-- 0152 — Hole maps: a super admin can put a green or tee right (Oct 2026).
--
-- WHY. golfapi.io's positions are sometimes plainly wrong: at Portmarnock
-- Hotel & Golf Links the 8th, 9th, 12th, 15th and 17th greens sat in the
-- dunes or on a neighbouring hole (seen 15 Oct 2026). On the hole map anyone
-- can already drag the flag or the T, but only for themselves, while the
-- screen is open. This lets a super admin keep what they dragged, for
-- everyone: they stand on the course (or look at the photo), drag the flag
-- onto the real green and press "Save for everyone".
--
-- WHAT. course_layout_fix_hole(layout, hole, green, tee) replaces that
-- hole's green_front / green_centre / back and/or its tee_back. The app works
-- the three green points out (hole-geo.ts, greenFromPin) so the database only
-- checks them. Every change is written to admin_audit_log with the old
-- positions, so it can be put back.
--
-- WHO. A super admin, read straight from staff_roles — NOT is_staff(): the
-- app's sessions never pass two-step sign-in (0135 design note), and this is
-- an app action taken on the course. Course positions are public course
-- information, so the risk of a stolen super-admin password here is a wrong
-- green, recorded in the audit log and reversible. Nothing private is opened.
--
-- Rollback:
--   drop function if exists public.course_layout_fix_hole(bigint, smallint, jsonb, jsonb);

create or replace function public.course_layout_fix_hole(p_layout_id bigint, p_hole smallint, p_green jsonb, p_tee jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old jsonb;
  v_kind text;
  v_pt jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.staff_roles sr where sr.user_id = v_uid and sr.status = 'active' and sr.role = 'super_admin'
  ) then
    raise exception 'Only a super admin can change a course map' using errcode = '42501';
  end if;
  if p_hole is null or p_hole not between 1 and 18 then
    raise exception 'Hole must be 1 to 18' using errcode = '22023';
  end if;
  if not exists (select 1 from public.course_layouts where id = p_layout_id) then
    raise exception 'No such course map' using errcode = 'P0002';
  end if;
  if p_green is null and p_tee is null then
    raise exception 'Nothing to save' using errcode = '22023';
  end if;

  -- What it was, for the audit log (and to put it back).
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'lat', lat, 'lng', lng)), '[]'::jsonb)
    into v_old
    from public.course_layout_points
    where layout_id = p_layout_id and hole = p_hole and kind in ('green_front', 'green_centre', 'green_back', 'tee_back');

  for v_kind, v_pt in
    select k, p from (values
      ('green_front', p_green -> 'front'),
      ('green_centre', p_green -> 'centre'),
      ('green_back', p_green -> 'back'),
      ('tee_back', p_tee)
    ) v(k, p)
    where p is not null and jsonb_typeof(p) = 'object'
  loop
    if (v_pt ->> 'lat') is null or (v_pt ->> 'lng') is null
       or (v_pt ->> 'lat')::float8 not between -90 and 90 or (v_pt ->> 'lng')::float8 not between -180 and 180 then
      raise exception 'Bad position for %', v_kind using errcode = '22023';
    end if;
    update public.course_layout_points
       set lat = (v_pt ->> 'lat')::float8, lng = (v_pt ->> 'lng')::float8, label = null
     where layout_id = p_layout_id and hole = p_hole and kind = v_kind;
    if not found then
      insert into public.course_layout_points (layout_id, hole, kind, lat, lng)
      values (p_layout_id, p_hole, v_kind, (v_pt ->> 'lat')::float8, (v_pt ->> 'lng')::float8);
    end if;
  end loop;

  update public.course_layouts set updated_at = now() where id = p_layout_id;

  insert into public.admin_audit_log (actor_id, actor_role, action, target_type, target_id, metadata, outcome)
  values (v_uid, 'super_admin', 'course_map.fix_hole', 'course_layout', p_layout_id::text,
          jsonb_build_object('hole', p_hole, 'green', p_green, 'tee', p_tee, 'before', v_old), 'success');
end;
$$;

comment on function public.course_layout_fix_hole(bigint, smallint, jsonb, jsonb) is 'Super admin only: replace a hole''s green front/centre/back and/or back tee on a course map, from the hole map ("Save for everyone"). Old positions go to admin_audit_log.';

revoke all on function public.course_layout_fix_hole(bigint, smallint, jsonb, jsonb) from public, anon;
grant execute on function public.course_layout_fix_hole(bigint, smallint, jsonb, jsonb) to authenticated;
