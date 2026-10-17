import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether the marketplace takes payments (0160 marketplace_settings).
 *
 * Off (the default since Oct 2026): members meet and pay each other in cash
 * or by Revolut, like Adverts. No Buy now, Buyer Protection, offers through
 * checkout, auctions or Stripe payouts — and a listing goes on sale without
 * the seller setting up Stripe. On: everything from 0114 as before.
 *
 * Read with whichever client the caller already has; the row is public. A
 * failed read answers "off", the safe side: nothing can take money by
 * accident.
 */
export async function marketplacePaymentsEnabled(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("marketplace_payments_enabled");
  if (error) return false;
  return data === true;
}

/** The sentence every money action answers with while payments are off. */
export const PAYMENTS_OFF_MESSAGE =
  "PinPals doesn't take payments for used gear — message the seller, meet up and pay them directly.";
