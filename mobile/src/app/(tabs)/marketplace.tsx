import { WebShell } from "@/components/web-shell";
import { webUrl } from "@/lib/config";

/**
 * The marketplace, as a web view.
 *
 * v1 shows the marketplace as an anonymous visitor sees it — browse, filters,
 * listing detail — which is why there is no session handoff yet (§4.2 of the
 * build spec). Buying, offering and listing all still happen on the site, and
 * the member signs in there once.
 *
 * When the handoff lands, only the URL here changes.
 */
export default function MarketplaceScreen() {
  return <WebShell uri={webUrl("/marketplace")} />;
}
