import { Redirect } from "expo-router";

/**
 * The marketplace menu's Sell button (see _layout.tsx). The tab press opens
 * the sell screen over everything instead of switching tab; this route only
 * exists so the tab does, and sends anything that lands here the same way.
 */
export default function MarketplaceSell() {
  return <Redirect href="/new-listing" />;
}
