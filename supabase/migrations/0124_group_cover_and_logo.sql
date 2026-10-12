-- A group's cover photo and logo (12 Oct 2026).
--
-- groups.cover_url — the photograph across the top of the group's page.
-- groups.logo_url  — the group's own badge, shown wherever its kind's icon
--                    was (the page, lists, Home, the draw screen).
--
-- WHO SETS THEM (decision, Eire, 12 Oct 2026): a society's captain or
-- secretary — and its owner, who appoints them. In a crew or trip, whoever
-- runs it (owner or admin). Ordinary members never.
--
-- HOW. The app sends the photo to the website's /api/app/groups/[id]/image
-- route, which re-encodes it with sharp (no EXIF, so no GPS — the 0112 cover
-- rule), stores it in the uploader's own folder of member-avatars, then
-- calls set_group_image() as that member. The function checks who's asking
-- and that the URL is in the caller's own folder, under a group- name, so a
-- member can't point a group at someone else's file or an outside address.
--
-- Rollback:
--   drop function if exists public.set_group_image(bigint, text, text);
--   revoke select (cover_url, logo_url) on public.groups from authenticated;
--   alter table public.groups drop column if exists cover_url, drop column if exists logo_url;

alter table public.groups
  add column if not exists cover_url text check (cover_url is null or char_length(cover_url) <= 500),
  add column if not exists logo_url text check (logo_url is null or char_length(logo_url) <= 500);

-- groups is read through a column grant (0120 withholds invite_code), so
-- new columns must be granted by name.
grant select (cover_url, logo_url) on public.groups to authenticated;

-- May this member change how the group looks?
create or replace function public.group_can_style(p_group_id bigint, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
             when g.kind = 'society' then m.role = 'owner' or m.office is not null
             else m.role in ('owner', 'admin')
           end
      from public.groups g
      join public.group_members m on m.group_id = g.id and m.member_id = p_user_id
     where g.id = p_group_id and g.hidden_at is null
  ), false);
$$;
revoke all on function public.group_can_style(bigint, uuid) from public, anon, authenticated;

-- p_which: 'cover' or 'logo'. p_url null puts the default back.
create or replace function public.set_group_image(p_group_id bigint, p_which text, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not public.group_can_style(p_group_id, me) then
    if (select kind from public.groups where id = p_group_id) = 'society' then
      raise exception 'Only the society''s captain or secretary can change its photo and logo.';
    end if;
    raise exception 'Only whoever runs the group can change its photo and logo.';
  end if;
  if p_which not in ('cover', 'logo') then
    raise exception 'Unknown image.';
  end if;
  if v_url is not null
     and (char_length(v_url) > 500
          or position('/storage/v1/object/public/member-avatars/' || me::text || '/group-' in v_url) = 0
          or v_url !~ '^https://') then
    raise exception 'That image can''t be used.';
  end if;

  if p_which = 'cover' then
    update public.groups set cover_url = v_url where id = p_group_id;
  else
    update public.groups set logo_url = v_url where id = p_group_id;
  end if;
end;
$$;
revoke all on function public.set_group_image(bigint, text, text) from public, anon, authenticated;
grant execute on function public.set_group_image(bigint, text, text) to authenticated;
