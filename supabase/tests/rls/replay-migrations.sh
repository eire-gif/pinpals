#!/usr/bin/env bash
# Replays every migration in supabase/migrations, plus the local-only bootstrap
# in setup-local-db-part{1,2}.sql, into a throwaway Postgres database — used
# both for local RLS test runs and by the CI workflow. There is no hosted
# Supabase branching on this project's plan, so this local replay is the only
# way to test a schema/RLS change before it reaches the real project.
#
# Connection is entirely via the standard PG* environment variables psql and
# node-postgres both already respect, so this script has no CLI flags of its
# own. Defaults match a plain `postgres:16` container (as used by both this
# sandbox and the CI service container):
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres
#   RLS_TEST_DB=pinpals_rls_test
#
# Usage: supabase/tests/rls/replay-migrations.sh
set -euo pipefail

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
: "${RLS_TEST_DB:=pinpals_rls_test}"
export PGHOST PGPORT PGUSER PGPASSWORD

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGDIR="$SCRIPT_DIR/../../migrations"
LOGFILE="$(mktemp)"

psql_admin() { psql -v ON_ERROR_STOP=1 -d postgres "$@"; }
psql_db() { psql -v ON_ERROR_STOP=1 -d "$RLS_TEST_DB" "$@"; }

echo "--- (re)creating database $RLS_TEST_DB on $PGHOST:$PGPORT ---"
psql_admin -c "drop database if exists \"$RLS_TEST_DB\";"
psql_admin -c "create database \"$RLS_TEST_DB\";"
psql_db -c "alter database \"$RLS_TEST_DB\" set search_path to public, extensions;"

run() {
  echo "--- applying $1 ---"
  psql_db -f "$2" >"$LOGFILE" 2>&1 || {
    echo "FAILED on $1"
    tail -50 "$LOGFILE"
    exit 1
  }
}

run "setup-local-db-part1.sql" "$SCRIPT_DIR/setup-local-db-part1.sql"

psql_db -c "CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;"

for f in 0001_init.sql 0002_seed_clubs.sql 0003_marketplace.sql; do
  run "$f" "$MIGDIR/$f"
done

run "setup-local-db-part2.sql" "$SCRIPT_DIR/setup-local-db-part2.sql"

for f in 0004_tee_time_browse_and_interests.sql 0005_tee_time_confirmations.sql 0006_member_connections.sql \
  0007_staff_roles.sql 0008_staff_roles_fix_is_staff_grants.sql 0009_admin_audit_log.sql \
  0010_admin_audit_log_fix_grants.sql 0011_listings_status_check.sql 0012_profiles_search_indexes.sql \
  0013_admin_user_notes.sql 0014_listings_search_indexes.sql 0015_listings_public_rls_excludes_removed.sql \
  0016_admin_reports.sql 0017_reports_search_indexes.sql 0018_reports_fk_indexes.sql; do
  run "$f" "$MIGDIR/$f"
done

# offers is schema-drift-only-fixed-by-0032 (see that file's header) — it must
# run before 0019_orders.sql, which FKs into a table no earlier committed
# migration creates on a from-scratch install.
run "0032_offers_reconcile.sql" "$MIGDIR/0032_offers_reconcile.sql"

for f in 0019_orders.sql 0020_stripe_connected_accounts.sql 0021_payments.sql 0022_payments_fix_search_path.sql \
  0023_refunds_and_disputes.sql 0024_payouts.sql 0025_messaging.sql 0026_support_cases.sql \
  0027_staff_roles_lockdown.sql 0028_rls_initplan_performance.sql 0029_fk_covering_indexes.sql \
  0030_webhook_event_types_rpc.sql 0031_rate_limiting.sql \
  0033_offers_status_expand.sql 0034_orders_lifecycle_and_delivery_snapshot.sql \
  0035_listings_status_expand_and_sale_type.sql 0036_listing_images.sql 0037_listing_favourites.sql \
  0038_offer_events.sql 0039_auctions_and_bids.sql 0040_order_events.sql 0041_reviews.sql \
  0042_notifications.sql 0043_conversations_marketplace_context.sql 0044_offers_self_dealing_trigger.sql \
  0045_marketplace_rls_hardening.sql 0046_listing_creation_workflow.sql \
  0047_marketplace_discovery.sql 0048_marketplace_offer_workflow.sql \
  0049_marketplace_messaging.sql 0050_marketplace_checkout.sql \
  0051_platform_fee_configuration.sql 0052_listing_visibility_returning_fix.sql \
  0053_marketplace_payments_reconciliation.sql 0054_payouts_member_select_policy.sql \
  0055_marketplace_trust_safety.sql; do
  run "$f" "$MIGDIR/$f"
done

rm -f "$LOGFILE"
echo "REPLAY OK — $RLS_TEST_DB is ready."
