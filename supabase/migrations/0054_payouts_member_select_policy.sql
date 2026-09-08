-- The new buyer/seller "workspace" dashboard pages (checkpoint
-- "marketplace-workspaces") need a seller to read their OWN payout history
-- for the "available/pending balance and payout history" view. `payouts`
-- (0024_payouts.sql) has only ever had a staff-only SELECT policy — this is
-- the first member-facing read anyone has needed from this table. Purely
-- additive: no existing policy, grant, or the table's own write-lockdown
-- (still service-role-only, untouched below) changes.
--
-- Rollback:
--   drop policy if exists "Members can view their own payouts" on public.payouts;

drop policy if exists "Members can view their own payouts" on public.payouts;
create policy "Members can view their own payouts"
  on public.payouts for select
  to authenticated
  using ((select auth.uid()) = user_id);
