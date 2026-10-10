import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * GET /go/deal/[id] — count the click on a retailer product (0115), then
 * send the golfer to the retailer. The URL (with the affiliate tag) comes
 * from affiliate_clicked(), so the page never carries it and a click is
 * always counted before the member leaves.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const fallback = new URL("/marketplace?mode=new", request.url);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.redirect(fallback);

  const supabase = await createClient();
  const { data } = await supabase.rpc("affiliate_clicked", { p_product_id: id, p_source: "web" });
  const url = typeof data === "string" && data.startsWith("https://") ? data : null;
  return NextResponse.redirect(url ?? fallback, 302);
}
