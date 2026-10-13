import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * GET /go/ad/[id] — count a tap on an advert (0139), then open the
 * advertiser's page. For links shared outside the app; the app logs through
 * ad_log() itself. A signed-in member's click bills once a day; a signed-out
 * one is counted apart and never billed (see ad_log()). An advert that isn't
 * running goes to the home page.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const fallback = new URL("/", request.url);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.redirect(fallback);

  const supabase = await createClient();
  const { data } = await supabase.rpc("ad_log", { p_campaign_id: id, p_kind: "click", p_source: "web" });
  const url = typeof data === "string" && data.startsWith("https://") ? data : null;
  return NextResponse.redirect(url ?? fallback, 302);
}
