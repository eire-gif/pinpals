import { Redirect } from "expo-router";

/**
 * The marketplace menu's Home button (see _layout.tsx). Pressing it never
 * lands here — the tab press goes straight to the app's Home — but a route
 * has to exist for the tab, and a link that did arrive should end up Home too.
 */
export default function MarketplaceHome() {
  return <Redirect href="/" />;
}
