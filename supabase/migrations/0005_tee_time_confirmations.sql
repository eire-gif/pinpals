-- Pinpals: two-step tee-time confirmation

alter table public.tee_time_interests
  drop constraint if exists tee_time_interests_status_check;

alter table public.tee_time_interests
  add constraint tee_time_interests_status_check
  check (status in ('pending', 'accepted', 'confirmed', 'declined'));

-- After a host offers a place, the interested golfer can either confirm it
-- or decline it. The server action also verifies the old status is accepted.
drop policy if exists "Members confirm accepted interest" on public.tee_time_interests;
create policy "Members confirm accepted interest"
  on public.tee_time_interests for update
  to authenticated
  using (
    member_id = auth.uid()
    and status = 'accepted'
  )
  with check (
    member_id = auth.uid()
    and status in ('confirmed', 'declined')
  );

