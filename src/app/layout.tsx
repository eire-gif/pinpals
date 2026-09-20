import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Playfair_Display, Public_Sans } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/site-header";
import SiteFooter from "@/components/site-footer";

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Pinpals | The golf community for Ireland and the UK",
  description:
    "Find golfers near you, browse every club in Ireland, Northern Ireland, England, Scotland and Wales, and connect with playing partners.",
  // Installability (0075). Without the manifest, "Add to Home Screen" on
  // iOS produces a bookmark rather than a standalone app — and push is
  // undeliverable on iPhone until the app is standalone.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Pinpals",
    statusBarStyle: "default",
  },
  // iOS ignores the manifest's icons array for the home-screen icon and
  // reads apple-touch-icon instead. Omitting it gets the member a
  // screenshot of the page as their icon, which is the single most common
  // way an installed PWA ends up looking broken.
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  // Paints the iOS status bar and the Android task switcher in navy-900
  // rather than white, so an installed Pinpals doesn't have a bright strip
  // above its own header.
  themeColor: "#0c2038",
};

/**
 * `pp_shell` is set by proxy.ts when a request carries `?shell=1` — that is,
 * when this page is being rendered inside the native app's web view. The app
 * already draws a tab bar and a title, so the site's own header and footer are
 * not just redundant there, they are the thing that makes a wrapper app look
 * like a wrapper app.
 *
 * Reading a cookie here makes the root layout dynamic, which it may not have
 * been before. In practice almost every page already reads cookies to know who
 * is signed in, so little changes — but `npm run build` prints the route table,
 * and if something that used to be static has flipped, that is the place it
 * will show.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const inAppShell = (await cookies()).get("pp_shell")?.value === "1";

  return (
    <html lang="en" className={`${playfair.variable} ${publicSans.variable} h-full`}>
      <body className="min-h-full flex flex-col font-sans antialiased">
        {!inAppShell && <SiteHeader />}
        <main className="flex-1">{children}</main>
        {!inAppShell && <SiteFooter />}
      </body>
    </html>
  );
}
