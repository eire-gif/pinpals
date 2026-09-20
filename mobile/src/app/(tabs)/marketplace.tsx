import { WebShell } from "@/components/web-shell";

/**
 * The marketplace, as a web view — but now as the signed-in member.
 *
 * It stays web rather than native because it is the largest surface, it
 * changes most often, and buying runs through Stripe Checkout, which has to be
 * a browser. Keeping it web means a marketplace change ships through Vercel
 * without an App Store review.
 *
 * WebShell hands the app's session over before loading, so favourites, offers,
 * messages and checkout all work here the way they do on the site. Before that
 * landed this tab showed every member the visitor's view — "Join to buy or
 * bid" — which was the single biggest way the app failed to be the website.
 */
export default function MarketplaceScreen() {
  return <WebShell path="/marketplace" />;
}
