-- Pinpals: "Ladies only" tee-time invites
--
-- One additive boolean on tee_time_invites. A host ticking the box is saying
-- who the round is for; every screen that renders an invite shows it as a
-- badge, and the email their connections get says so too.
--
-- ============ Why this is a label and not a lock ============
--
-- This column does NOT restrict who may express interest, and no RLS policy
-- reads it. Enforcing it would mean knowing which members are women, and this
-- database holds no sex or gender field on `profiles` — by omission, not by
-- oversight. Adding one would mean asking every member to state their sex
-- before they could use an unrelated feature, and storing that for everyone
-- forever, to gate a small number of rounds. That is a much larger decision
-- than this column, and it is not made here.
--
-- So this sits exactly where `handicap_limit` already sits (0001): a stated
-- condition a host sets and members honour, shown clearly rather than
-- enforced silently. If real enforcement is ever wanted, it needs its own
-- migration, a profile field, and a deliberate decision to collect it —
-- and this column would become the flag that policy reads, unchanged.
--
-- ============ Default ============
--
-- false, not null: every invite posted before this migration was open to
-- anyone, which is what false means. No backfill needed.

alter table public.tee_time_invites
  add column if not exists ladies_only boolean not null default false;

comment on column public.tee_time_invites.ladies_only is
  'Host has asked that only women join this round. A displayed preference, not an access rule — nothing in RLS reads this column. See 0074 for why.';
