import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/** GET /go/banner/[id] — count a sponsored banner tap (0115), then open the sponsor's page. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const fallback = new URL("/marketplace?mode=new", request.url);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.redirect(fallback);

  const supabase = await createClient();
  const { data } = await supabase.rpc("banner_clicked", { p_banner_id: id });
  const url = typeof data === "string" && data.startsWith("https://") ? data : null;
  return NextResponse.redirect(url ?? fallback, 302);
}
