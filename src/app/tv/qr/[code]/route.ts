import QRCode from "qrcode";

import { getSiteUrl } from "@/lib/site-url";
import { normaliseTvCode } from "@/lib/tv-token";

/**
 * GET /tv/qr/<code> — the QR on the TV's pairing screen. It holds only the
 * public address /live/tv?code=<code>: on a phone with PinPals that opens
 * the app's Show on TV screen with the code filled in (universal link);
 * without the app it's a page saying how to get it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = normaliseTvCode((await params).code);
  if (!code) return new Response("Not found", { status: 404 });
  const png = await QRCode.toBuffer(`${getSiteUrl()}/live/tv?code=${code}`, {
    type: "png",
    width: 600,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0c2038", light: "#ffffff" },
  });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } });
}
