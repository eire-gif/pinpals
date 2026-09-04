-- Fix for 0021_payments.sql: the Supabase security linter (get_advisors)
-- flagged all five new functions as "Function Search Path Mutable" —
-- created without `set search_path`, so a caller able to manipulate the
-- session's search_path could, in principle, get an unqualified identifier
-- inside the function body resolved against a different schema. Every
-- identifier in these five functions is already schema-qualified
-- (public.orders, public.webhook_events) so this was never actually
-- exploitable here, but pinning search_path is the correct fix rather than
-- relying on that — same class of gap as the pre-existing warning on
-- public.set_updated_at() (flagged in claude/admin-architecture-review.md's
-- Phase 0 backlog, not touched by this migration since that function is
-- unrelated to payments and used by every table in this schema).
--
-- CREATE OR REPLACE FUNCTION redefines the body without resetting the
-- REVOKE EXECUTE ... FROM public, anon, authenticated already applied in
-- 0021 — Postgres grants attach to the function's identity (name + argument
-- types), not its definition, and neither changes here.
create or replace function public.claim_webhook_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_api_version text,
  p_payload jsonb
)
returns table (id bigint, status text, is_new boolean)
language plpgsql
set search_path = public
as $$
begin
  return query
  insert into public.webhook_events (provider, event_id, event_type, api_version, payload)
  values (p_provider, p_event_id, p_event_type, p_api_version, p_payload)
  on conflict (provider, event_id) do update
    set attempts = public.webhook_events.attempts + 1
  returning webhook_events.id, webhook_events.status, (xmax = 0) as is_new;
end;
$$;

create or replace function public.apply_order_payment_succeeded(
  p_event_row_id bigint,
  p_order_id bigint,
  p_payment_intent_id text,
  p_currency text
)
returns setof public.orders
language plpgsql
set search_path = public
as $$
begin
  update public.webhook_events
    set status = 'processed',
        processed_at = now(),
        related_order_id = p_order_id
    where id = p_event_row_id;

  return query
  update public.orders
    set payment_status = 'paid',
        status = case when status = 'pending' then 'completed' else status end,
        payment_reference = p_payment_intent_id,
        currency = p_currency,
        payment_last_error = null,
        completed_at = coalesce(completed_at, now())
    where id = p_order_id
      and payment_status <> 'paid'
    returning *;
end;
$$;

create or replace function public.apply_order_payment_failed(
  p_event_row_id bigint,
  p_order_id bigint,
  p_payment_intent_id text,
  p_error text
)
returns setof public.orders
language plpgsql
set search_path = public
as $$
begin
  update public.webhook_events
    set status = 'processed',
        processed_at = now(),
        related_order_id = p_order_id
    where id = p_event_row_id;

  return query
  update public.orders
    set payment_status = 'failed',
        payment_reference = p_payment_intent_id,
        payment_last_error = p_error
    where id = p_order_id
      and payment_status <> 'paid'
    returning *;
end;
$$;

create or replace function public.apply_order_payment_refunded(
  p_event_row_id bigint,
  p_order_id bigint,
  p_refund_amount_eur numeric,
  p_reason text
)
returns setof public.orders
language plpgsql
set search_path = public
as $$
begin
  update public.webhook_events
    set status = 'processed',
        processed_at = now(),
        related_order_id = p_order_id
    where id = p_event_row_id;

  return query
  update public.orders
    set payment_status = 'refunded',
        status = 'refunded',
        refunded_amount_eur = p_refund_amount_eur,
        refunded_at = coalesce(refunded_at, now()),
        refund_reason = coalesce(refund_reason, p_reason)
    where id = p_order_id
    returning *;
end;
$$;

create or replace function public.mark_webhook_event_terminal(
  p_event_row_id bigint,
  p_status text,
  p_error text,
  p_related_order_id bigint
)
returns void
language plpgsql
set search_path = public
as $$
begin
  update public.webhook_events
    set status = p_status,
        last_error = p_error,
        processed_at = case when p_status in ('processed', 'ignored') then now() else processed_at end,
        related_order_id = coalesce(p_related_order_id, related_order_id)
    where id = p_event_row_id;
end;
$$;
