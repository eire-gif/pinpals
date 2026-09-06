-- Lets an existing conversation (0025_messaging.sql) optionally be "about"
-- a listing, so marketplace buyer/seller messaging can reuse the existing
-- two-party conversations/messages tables and their RLS as-is, rather than
-- introducing a parallel messaging system. This is also why there's no new
-- `conversation_members` table: every conversation here is strictly
-- two-party (user_a_id/user_b_id), which already fits a buyer<->seller
-- marketplace thread directly — a separate members join table would only
-- be needed for group conversations, which nothing in this schema requires.
--
-- `on delete set null` (not cascade) matches the existing "drill-through
-- convenience link only" convention (orders.listing_id, disputes.order_id,
-- etc. — 0019/0023): a removed listing shouldn't delete a conversation's
-- message history.
--
-- Rollback: `alter table public.conversations drop column if exists listing_id;`

alter table public.conversations
  add column if not exists listing_id bigint references public.listings (id) on delete set null;

create index if not exists conversations_listing_id_idx on public.conversations (listing_id);
