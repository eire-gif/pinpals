import QRCode from "qrcode";

import { invitePath, isInviteCode } from "@/lib/find-pinpals";
import { getSiteUrl } from "@/lib/site-url";

/**
 * GET /join/<code>/qr — the member's QR code as a PNG, for the app's
 * "Your PinPals code" (drawn here so the app needs no QR library) and for
 * printing. It encodes only the public invite URL.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isInviteCode(code)) return new Response("Not found", { status: 404 });
  const png = await QRCode.toBuffer(`${getSiteUrl()}${invitePath(code.toLowerCase())}`, {
    type: "png",
    width: 600,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0c2038", light: "#ffffff" },
  });
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, immutable" },
  });
}
