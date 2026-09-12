import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${playfair.variable} ${publicSans.variable} h-full`}>
      <body className="min-h-full flex flex-col font-sans antialiased">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
